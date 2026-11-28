import { createFileRoute, redirect, useLocation } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import { Fingerprint, LoaderCircle, UserRound } from "lucide-react";
import { toast } from "sonner";
import { declinePasskeyPromptFn, getConsentApp, getSetupStep } from "@/auth/account.functions";
import { authClient } from "@/auth/client";
import { PASSKEY_UNSUPPORTED_COOKIE } from "@/auth/cookies";
import { useViewer } from "@/components/access";
import { ExpiredSignIn, useSignInExpiry } from "@/components/expired-sign-in";
import { LoginLayout } from "@/components/login-page";
import { NameForm } from "@/components/name-form";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { errorMessage } from "@/lib/action-error";

/**
 * Where an app sign-in stops on its way to the app (see `postLogin` in `src/auth/index.ts`):
 * once to confirm a self-declared name, and once to offer a passkey to someone who has none.
 * Each step continues the same sign-in, which comes back here while another one is due.
 */
export const Route = createFileRoute("/setup")({
  head: () => ({ meta: [{ title: "Before you continue · PoliNetwork Auth" }] }),
  // Passes the signed OAuth query through unchanged, so its signature keeps verifying.
  validateSearch: (search: Record<string, unknown>): Record<string, unknown> => search,
  // Without a sign-in to continue there is nothing to do here: the account page has it all.
  beforeLoad: ({ search }) => {
    if (!("sig" in search)) throw redirect({ to: "/" });
  },
  loaderDeps: ({ search }) => ({
    clientId:
      typeof search.client_id === "string" || typeof search.client_id === "number"
        ? String(search.client_id)
        : "",
  }),
  loader: async ({ context, deps }) => {
    if (!context.viewer) return null;
    const [setup, consent] = await Promise.all([
      getSetupStep(),
      deps.clientId ? getConsentApp({ data: { clientId: deps.clientId } }) : null,
    ]);
    return { ...setup, appName: consent?.app?.name ?? "the application" };
  },
  component: SetupPage,
});

type Expiry = ReturnType<typeof useSignInExpiry>;

/** Resumes the sign-in; the auth client follows the redirect to the next step, consent or the app. */
async function continueSignIn(expiry: Expiry) {
  try {
    const result = await authClient.oauth2.continue({ postLogin: true });
    if (!result.error) return true;
    if ("error" in result.error && result.error.error === "invalid_signature") {
      // The sign-in expired while the person was here: go back to the application. Stay busy
      // only while the page leaves; if the server says it's still valid, show an error.
      if (await expiry.expire()) return true;
    }
    toast.error(
      result.error.message ?? "Unable to continue. Go back to the application and try again.",
    );
  } catch {
    toast.error("Unable to reach PoliNetwork. Please try again.");
  }
  return false;
}

function SetupPage() {
  const viewer = useViewer();
  const data = Route.useLoaderData();
  // Someone may be in the middle of a step: don't leave under them.
  const expiry = useSignInExpiry(useLocation().searchStr, { leave: "ask" });

  useEffect(() => {
    // The session ended on the way here: sign in again with the same, still signed request.
    if (!viewer) window.location.replace(`/${window.location.search}`);
  }, [viewer]);

  if (expiry.state.status !== "active") {
    return (
      <LoginLayout wide>
        <ExpiredSignIn state={expiry.state} />
      </LoginLayout>
    );
  }

  if (!viewer || !data) {
    return (
      <LoginLayout wide>
        <p role="status" className="text-center text-sm text-muted-foreground">
          Preparing your sign-in…
        </p>
      </LoginLayout>
    );
  }

  return data.step === "name" ? (
    <NameStep name={data.name} appName={data.appName} expiry={expiry} />
  ) : (
    <PasskeyStep appName={data.appName} expiry={expiry} />
  );
}

function StepCard({
  icon,
  title,
  children,
}: {
  icon: ReactNode;
  title: string;
  children: ReactNode;
}) {
  return (
    <LoginLayout wide>
      <Card>
        <CardContent className="space-y-6 px-6 pt-8 pb-8 sm:px-8">
          <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            {icon}
          </div>
          <h1 className="text-center text-2xl font-bold tracking-tight text-balance">{title}</h1>
          {children}
        </CardContent>
      </Card>
    </LoginLayout>
  );
}

/** A self-declared name nobody confirmed: Google's, or a guess from the old single name. */
function NameStep({
  name,
  appName,
  expiry,
}: {
  name: { givenName: string; familyName: string };
  appName: string;
  expiry: Expiry;
}) {
  return (
    <StepCard icon={<UserRound className="size-7" aria-hidden="true" />} title="Confirm your name">
      <p className="-mt-3 text-center text-sm leading-6 text-muted-foreground">
        Write your real first and last name, as on your ID. PoliNetwork's administrators and the
        applications you use will see it, marked as declared by you.
      </p>
      <NameForm
        initial={name}
        submitLabel="Confirm and continue"
        onSaved={() => continueSignIn(expiry)}
        footer={
          <p className="text-center text-xs leading-5 text-muted-foreground">
            Then you'll continue to <span className="font-medium text-foreground">{appName}</span>.
            You can change your name later from your PoliNetwork account.
          </p>
        }
      />
    </StepCard>
  );
}

function PasskeyStep({ appName, expiry }: { appName: string; expiry: Expiry }) {
  const [busy, setBusy] = useState<"add" | "skip" | null>(null);
  const [supported, setSupported] = useState<boolean | null>(null);

  useEffect(() => {
    if (window.isSecureContext && window.PublicKeyCredential) {
      setSupported(true);
      return;
    }
    // Nothing to offer in this browser: move on, and keep its next sign-ins from stopping here.
    setSupported(false);
    const secure = window.location.protocol === "https:" ? "; Secure" : "";
    document.cookie = `${PASSKEY_UNSUPPORTED_COOKIE}=1; Path=/; SameSite=Lax${secure}`;
    void continueSignIn(expiry);
    // Once, when the step shows.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function addPasskey() {
    setBusy("add");
    try {
      const result = await authClient.passkey.addPasskey();
      if (result.error) {
        toast.error("The passkey wasn't added. Try again, or skip this step.");
      } else {
        toast.success("Passkey added.");
        // Stay busy while the browser leaves for the application.
        if (await continueSignIn(expiry)) return;
      }
    } catch {
      toast.error("Unable to reach PoliNetwork. Please try again.");
    }
    setBusy(null);
  }

  async function skip() {
    setBusy("skip");
    try {
      // Recorded first: continuing without it would bring the person straight back here.
      await declinePasskeyPromptFn();
      if (await continueSignIn(expiry)) return;
    } catch (cause) {
      toast.error(errorMessage(cause, "Unable to skip this step. Please try again."));
    }
    setBusy(null);
  }

  if (supported === false) {
    return (
      <LoginLayout wide>
        <p role="status" className="text-center text-sm text-muted-foreground">
          Continuing to {appName}…
        </p>
      </LoginLayout>
    );
  }

  return (
    <StepCard
      icon={<Fingerprint className="size-7" aria-hidden="true" />}
      title="Sign in faster next time"
    >
      <p className="-mt-3 text-center text-sm leading-6 text-muted-foreground">
        Add a passkey to sign in with your fingerprint, face or screen lock. It's quicker than going
        through your account, and it can't be phished.
      </p>
      <div className="grid gap-3">
        <Button
          type="button"
          className="h-11"
          disabled={busy !== null || !supported}
          onClick={() => void addPasskey()}
        >
          {busy === "add" ? (
            <LoaderCircle className="animate-spin" aria-hidden="true" />
          ) : (
            <Fingerprint aria-hidden="true" />
          )}
          {busy === "add" ? "Waiting for your passkey…" : "Add a passkey"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          className="h-11"
          disabled={busy !== null}
          onClick={() => void skip()}
        >
          {busy === "skip" && <LoaderCircle className="animate-spin" aria-hidden="true" />}
          Skip
        </Button>
      </div>
      <p className="text-center text-xs leading-5 text-muted-foreground">
        Either way, you'll continue to{" "}
        <span className="font-medium text-foreground">{appName}</span>. If you skip, we won't ask
        again; you can add a passkey from your PoliNetwork account at any time.
      </p>
    </StepCard>
  );
}
