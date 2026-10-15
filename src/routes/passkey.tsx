import { createFileRoute, redirect } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Fingerprint, LoaderCircle } from "lucide-react";
import { toast } from "sonner";
import { declinePasskeyPromptFn, getConsentApp } from "@/auth/account.functions";
import { authClient } from "@/auth/client";
import { PASSKEY_UNSUPPORTED_COOKIE } from "@/auth/cookies";
import { useViewer } from "@/components/access";
import { LoginLayout } from "@/components/login-page";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { errorMessage } from "@/lib/action-error";

/**
 * Where an app sign-in stops, once, to offer a passkey to someone who has none (see
 * `postLogin` in `src/auth/index.ts`). Adding one or skipping continues the same sign-in.
 */
export const Route = createFileRoute("/passkey")({
  head: () => ({ meta: [{ title: "Add a passkey · PoliNetwork Auth" }] }),
  // Passes the signed OAuth query through unchanged, so its signature keeps verifying.
  validateSearch: (search: Record<string, unknown>): Record<string, unknown> => search,
  // Without a sign-in to continue there is nothing to offer here: the account page adds passkeys.
  beforeLoad: ({ search }) => {
    if (!("sig" in search)) throw redirect({ to: "/" });
  },
  loaderDeps: ({ search }) => ({
    clientId:
      typeof search.client_id === "string" || typeof search.client_id === "number"
        ? String(search.client_id)
        : "",
  }),
  loader: ({ context, deps }) =>
    context.viewer && deps.clientId ? getConsentApp({ data: { clientId: deps.clientId } }) : null,
  component: PasskeyOffer,
});

function PasskeyOffer() {
  const viewer = useViewer();
  const appName = Route.useLoaderData()?.app?.name ?? "the application";
  const [busy, setBusy] = useState<"add" | "skip" | null>(null);
  const [supported, setSupported] = useState<boolean | null>(null);

  useEffect(() => {
    // The session ended on the way here: sign in again with the same, still signed request.
    if (!viewer) {
      window.location.replace(`/${window.location.search}`);
      return;
    }
    if (window.isSecureContext && window.PublicKeyCredential) {
      setSupported(true);
      return;
    }
    // Nothing to offer in this browser: move on, and keep its next sign-ins from stopping here.
    setSupported(false);
    const secure = window.location.protocol === "https:" ? "; Secure" : "";
    document.cookie = `${PASSKEY_UNSUPPORTED_COOKIE}=1; Path=/; SameSite=Lax${secure}`;
    void continueSignIn();
  }, [viewer]);

  /** Resumes the sign-in; the auth client follows the redirect to consent or to the app. */
  async function continueSignIn() {
    try {
      const result = await authClient.oauth2.continue({ postLogin: true });
      if (!result.error) return true;
      toast.error(
        result.error.message ?? "Unable to continue. Go back to the application and try again.",
      );
    } catch {
      toast.error("Unable to reach PoliNetwork. Please try again.");
    }
    return false;
  }

  async function addPasskey() {
    setBusy("add");
    try {
      const result = await authClient.passkey.addPasskey();
      if (result.error) {
        toast.error("The passkey wasn't added. Try again, or skip this step.");
      } else {
        toast.success("Passkey added.");
        // Stay busy while the browser leaves for the application.
        if (await continueSignIn()) return;
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
      if (await continueSignIn()) return;
    } catch (cause) {
      toast.error(errorMessage(cause, "Unable to skip this step. Please try again."));
    }
    setBusy(null);
  }

  if (!viewer || supported === false) {
    return (
      <LoginLayout wide>
        <p role="status" className="text-center text-sm text-muted-foreground">
          {viewer ? `Continuing to ${appName}…` : "Preparing your sign-in…"}
        </p>
      </LoginLayout>
    );
  }

  return (
    <LoginLayout wide>
      <Card>
        <CardContent className="space-y-6 px-6 pt-8 pb-8 sm:px-8">
          <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <Fingerprint className="size-7" aria-hidden="true" />
          </div>
          <div className="text-center">
            <h1 className="text-2xl font-bold tracking-tight text-balance">
              Sign in faster next time
            </h1>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Add a passkey to sign in with your fingerprint, face or screen lock. It's quicker than
              going through your account, and it can't be phished.
            </p>
          </div>
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
            <span className="font-medium text-foreground">{appName}</span>. If you skip, we won't
            ask again; you can add a passkey from your PoliNetwork account at any time.
          </p>
        </CardContent>
      </Card>
    </LoginLayout>
  );
}
