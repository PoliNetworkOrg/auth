import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { getAccount, unlinkAccountFn } from "@/auth/account.functions";
import { authClient } from "@/auth/client";
import { isLoginProvider } from "@/auth/policy";
import { STATIC_ROLES } from "@/auth/rbac";
import type { Viewer } from "@/auth/session.functions";
import { useProviders, useViewer } from "@/components/access";
import { StudentVerificationForm } from "@/components/student-verification-form";
import { UserAvatar } from "@/components/user-avatar";
import { GoogleIcon } from "@/components/google-icon";
import { LoginPage } from "@/components/login-page";
import { PasskeyCard } from "@/components/passkey-card";
import {
  BadgeCheck,
  Building2,
  Check,
  Fingerprint,
  LoaderCircle,
  LogOut,
  Send,
  ShieldCheck,
  Unlink,
} from "lucide-react";
import { AppHeader } from "@/components/app-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { errorMessage } from "@/lib/action-error";

export const Route = createFileRoute("/")({
  // `/` is also the OIDC sign-in page: it reads the signed OAuth query as it is, so it has
  // no search validation that could drop or rewrite those parameters.
  loader: ({ context }) => (context.viewer ? getAccount() : null),
  component: Home,
});
const signInOptions = [
  {
    id: "google",
    name: "Google",
    description: "Use your Google account to sign in to PoliNetwork.",
  },
  {
    id: "pn-entra",
    name: "PoliNetwork APS",
    description: "Use your PoliNetwork Microsoft account to sign in and verify membership.",
  },
];

type Account = NonNullable<Awaited<ReturnType<typeof getAccount>>>;

/** The built-in roles each verified state grants, named for the person who holds them. */
const STATE_LABELS: Record<string, string> = Object.fromEntries(
  STATIC_ROLES.map((role) => [role.state, role.name]),
);

function Home() {
  const viewer = useViewer();
  const account = Route.useLoaderData();
  if (!viewer || !account) return <LoginPage />;
  return <AccountPage key={viewer.user.id} viewer={viewer} account={account} />;
}

function AccountPage({ viewer, account }: { viewer: Viewer; account: Account }) {
  const router = useRouter();
  const providers = useProviders();
  const { accounts, identity, passkeys } = account;
  const [error, setError] = useState("");
  /** The provider being linked, the account being unlinked, or "sign-out", so only that button spins. */
  const [busy, setBusy] = useState<string | null>(null);
  const loginAccountCount = accounts.filter((account) =>
    isLoginProvider(account.providerId),
  ).length;

  async function connect(provider: string) {
    setBusy(provider);
    setError("");
    try {
      const result = await authClient.linkSocial({ provider, callbackURL: "/" });
      if (result.error) setError(result.error.message ?? "Sign-in failed.");
    } catch {
      setError("Unable to contact the identity service.");
    } finally {
      setBusy(null);
    }
  }
  async function unlink(accountId: string) {
    setBusy(accountId);
    setError("");
    try {
      await unlinkAccountFn({ data: { accountId } });
      // Brings the accounts, membership and student status up to date.
      await router.invalidate({ sync: true });
    } catch (cause) {
      setError(errorMessage(cause, "Unable to unlink account."));
    } finally {
      setBusy(null);
    }
  }
  async function signOut() {
    setBusy("sign-out");
    setError("");
    try {
      const result = await authClient.signOut();
      if (result.error) setError(result.error.message ?? "Unable to sign out.");
      // The root context still holds the old session until it loads again.
      else await router.invalidate({ sync: true });
    } catch {
      setError("Unable to sign out.");
    } finally {
      setBusy(null);
    }
  }
  const telegramAccounts = accounts.filter((account) => account.providerId === "telegram");
  const studentAccount = accounts.find((account) => account.providerId === "polimi-email");
  return (
    <div className="min-h-screen">
      <AppHeader active="account" />
      <main className="mx-auto max-w-6xl px-5 py-10 sm:px-8 sm:py-14">
        <div className="mb-9 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">
              Your place in PoliNetwork.
            </h1>
            <p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground">
              Your accounts, your membership. Together in one place.
            </p>
          </div>
          <Badge className="bg-card text-muted-foreground">Preview</Badge>
        </div>
        {error && (
          <p
            role="alert"
            className="mb-6 rounded-xl border border-destructive bg-destructive/5 p-4 text-sm"
          >
            {error}
          </p>
        )}
        <div className="grid items-start gap-8 lg:grid-cols-[320px_1fr]">
          <aside className="space-y-5">
            <section className="identity-pass rounded-2xl p-7" aria-label="Your identity">
              <div className="relative z-10">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-semibold">PoliNetwork</span>
                  <Fingerprint className="size-6" aria-hidden="true" />
                </div>
                <div className="mt-12 flex size-16 items-center justify-center overflow-hidden rounded-2xl border border-white/30 bg-white/10 text-2xl font-semibold">
                  <UserAvatar name={viewer.user.name} image={viewer.user.image} />
                </div>
                <h2 className="mt-5 break-words text-2xl font-bold tracking-tight">
                  {viewer.user.name}
                </h2>
                <p className="mt-2 text-sm leading-6 text-blue-100">Your PoliNetwork identity</p>
                <div
                  className="mt-8 flex min-h-9 flex-wrap gap-2 border-t border-white/25 pt-5"
                  aria-live="polite"
                >
                  {identity.states.length ? (
                    identity.states.map((state) => (
                      <Badge key={state} className="border-white/30 bg-white/15 text-white">
                        <BadgeCheck className="size-3.5" />
                        {STATE_LABELS[state] ?? state}
                      </Badge>
                    ))
                  ) : (
                    <p className="text-xs leading-5 text-blue-100">
                      Link your accounts to add membership and student status.
                    </p>
                  )}
                </div>
              </div>
            </section>
            <div className="flex gap-3 px-1 text-sm leading-6 text-muted-foreground">
              <ShieldCheck className="mt-1 size-5 shrink-0 text-primary" aria-hidden="true" />
              <p>
                Membership is checked automatically. Your linked accounts stay under your control.
              </p>
            </div>
            <Button
              variant="ghost"
              className="text-muted-foreground"
              disabled={busy !== null}
              onClick={() => void signOut()}
            >
              {busy === "sign-out" ? (
                <LoaderCircle className="animate-spin" aria-hidden="true" />
              ) : (
                <LogOut />
              )}
              Sign out
            </Button>
          </aside>
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Login accounts</CardTitle>
                <CardDescription>Choose how you sign in to PoliNetwork.</CardDescription>
              </CardHeader>
              <CardContent className="divide-y pb-0">
                {signInOptions.map((option) => {
                  const linked = accounts.filter((account) => account.providerId === option.id);
                  return (
                    <div
                      key={option.id}
                      className="flex flex-wrap items-center gap-4 py-6 first:pt-1"
                    >
                      <div className="flex size-11 shrink-0 items-center justify-center rounded-xl border bg-background text-primary">
                        {option.id === "google" ? (
                          <GoogleIcon className="size-5" />
                        ) : (
                          <Building2 className="size-5" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1 basis-40">
                        <h3 className="text-sm font-semibold">{option.name}</h3>
                        <p className="mt-1 text-xs leading-5 text-muted-foreground">
                          {option.id === "google"
                            ? "Your personal Google account"
                            : "Microsoft account and PN membership"}
                        </p>
                        {linked.length > 0 && (
                          <span className="mt-2 inline-flex items-center gap-1 text-xs text-primary">
                            <Check className="size-3.5" />
                            Linked
                          </span>
                        )}
                        {linked.length > 0 && loginAccountCount < 2 && (
                          <p className="mt-2 text-xs leading-5 text-muted-foreground">
                            Link another login account to enable unlinking.
                          </p>
                        )}
                      </div>
                      {linked.length === 0 ? (
                        <Button
                          variant="outline"
                          disabled={busy !== null || !providers.signIn.includes(option.id)}
                          onClick={() => void connect(option.id)}
                        >
                          {busy === option.id && (
                            <LoaderCircle className="animate-spin" aria-hidden="true" />
                          )}
                          {providers.signIn.includes(option.id) ? "Link account" : "Unavailable"}
                        </Button>
                      ) : (
                        linked.map((account) => (
                          <Button
                            key={account.id}
                            variant="destructive"
                            size="sm"
                            disabled={busy !== null || loginAccountCount < 2}
                            onClick={() => void unlink(account.id)}
                          >
                            {busy === account.id ? (
                              <LoaderCircle className="animate-spin" aria-hidden="true" />
                            ) : (
                              <Unlink className="size-3.5" />
                            )}
                            Unlink
                          </Button>
                        ))
                      )}
                    </div>
                  );
                })}
              </CardContent>
            </Card>
            <PasskeyCard passkeys={passkeys} />
            <Card>
              <CardHeader>
                <CardTitle>Community & university</CardTitle>
                <CardDescription>
                  Link the accounts that are part of your everyday life.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <section className="flex flex-wrap items-start gap-4 border-b pb-6">
                  <div className="flex size-11 shrink-0 items-center justify-center rounded-xl border bg-background text-primary">
                    <Send className="size-5" aria-hidden="true" />
                  </div>
                  <div className="min-w-0 flex-1 basis-40">
                    <h3 className="text-sm font-semibold">Telegram</h3>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">
                      Link your Telegram identity for PoliNetwork bots.
                    </p>
                    {telegramAccounts.length > 0 && (
                      <p className="mt-2 inline-flex items-center gap-1 text-xs text-primary">
                        <Check className="size-3.5" />
                        Linked{identity.telegramId ? ` · ${identity.telegramId}` : ""}
                      </p>
                    )}
                  </div>
                  {!telegramAccounts.length && (
                    <Button
                      variant="outline"
                      disabled={busy !== null || !providers.link.includes("telegram")}
                      onClick={() => void connect("telegram")}
                    >
                      {busy === "telegram" && (
                        <LoaderCircle className="animate-spin" aria-hidden="true" />
                      )}
                      {providers.link.includes("telegram") ? "Link account" : "Unavailable"}
                    </Button>
                  )}
                  {telegramAccounts.map((account) => (
                    <Button
                      key={account.id}
                      variant="destructive"
                      size="sm"
                      disabled={busy !== null}
                      onClick={() => void unlink(account.id)}
                    >
                      {busy === account.id ? (
                        <LoaderCircle className="animate-spin" aria-hidden="true" />
                      ) : (
                        <Unlink className="size-3.5" />
                      )}
                      Unlink
                    </Button>
                  ))}
                </section>
                <StudentVerificationForm
                  configured={providers.link.includes("polimi-email")}
                  linkedAccount={studentAccount}
                  verified={identity.states.includes("student")}
                  canUnlink={busy === null}
                  unlinking={!!studentAccount && busy === studentAccount.id}
                  onUnlink={unlink}
                />
              </CardContent>
            </Card>
          </div>
        </div>
        <footer className="mt-12 flex flex-wrap items-start justify-between gap-4 border-t pt-6 text-xs leading-5 text-muted-foreground">
          <p>PoliNetwork APS</p>
          <p className="sm:text-right">
            PoliNetwork Auth is in preview. Existing PoliNetwork services still use their current
            sign-in.
          </p>
        </footer>
      </main>
    </div>
  );
}
