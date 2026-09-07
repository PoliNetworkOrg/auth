import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { authClient } from "@/auth/client";
import { type identityClaims, isLoginProvider } from "@/auth/policy";
import { StudentVerificationForm } from "@/components/student-verification-form";
import { UserAvatar } from "@/components/user-avatar";
import { GoogleIcon } from "@/components/google-icon";
import { LoginPage, LoginLayout } from "@/components/login-page";
import { PasskeyCard } from "@/components/passkey-card";
import {
  BadgeCheck,
  Building2,
  Check,
  Fingerprint,
  LogOut,
  Send,
  ShieldCheck,
  Unlink,
  UserRound,
} from "lucide-react";
import { ThemeSwitch } from "@/components/theme-switch";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/")({ component: Home });
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

type ProviderCapabilities = { signIn: string[]; link: string[] };

function Home() {
  const { data: session, isPending, error, refetch } = authClient.useSession();

  if (isPending) {
    return (
      <LoginLayout>
        <p role="status" className="text-center text-sm text-muted-foreground">
          Loading your session…
        </p>
      </LoginLayout>
    );
  }
  if (error) {
    return (
      <LoginLayout>
        <div className="space-y-4 text-center">
          <p role="alert">Unable to load your session. Please try again.</p>
          <Button onClick={() => void refetch()}>Try again</Button>
        </div>
      </LoginLayout>
    );
  }
  if (!session) return <LoginPage />;
  return <AccountPage key={session.user.id} />;
}

function AccountPage() {
  const { data: session, isPending } = authClient.useSession();
  const [providers, setProviders] = useState<ProviderCapabilities>({ signIn: [], link: [] });
  const [accounts, setAccounts] = useState<{ id: string; providerId: string; accountId: string }[]>(
    [],
  );
  const [identity, setIdentity] = useState<ReturnType<typeof identityClaims> | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const loginAccountCount = accounts.filter((account) =>
    isLoginProvider(account.providerId),
  ).length;
  useEffect(() => {
    let active = true;
    async function load() {
      const response = await fetch("/api/providers");
      if (!response.ok) throw new Error("Unable to load sign-in methods.");
      const capabilities: ProviderCapabilities = await response.json();
      if (active) setProviders(capabilities);
      if (session) {
        const linked = await authClient.listAccounts();
        if (linked.error) throw new Error(linked.error.message);
        const result = await fetch("/api/identity");
        if (!result.ok) throw new Error("Unable to load your identity.");
        const value: ReturnType<typeof identityClaims> = await result.json();
        if (active) {
          setAccounts(linked.data);
          setIdentity(value);
        }
      } else if (active) {
        setAccounts([]);
        setIdentity(null);
      }
    }
    void load().catch((cause: unknown) => {
      if (active) setError(cause instanceof Error ? cause.message : "Unable to load account.");
    });
    return () => {
      active = false;
    };
  }, [session, revision]);

  async function connect(provider: string) {
    setBusy(true);
    setError("");
    try {
      const result = session
        ? await authClient.linkSocial({ provider, callbackURL: "/" })
        : await authClient.signIn.social({ provider, callbackURL: "/" });
      if (result.error) setError(result.error.message ?? "Sign-in failed.");
    } catch {
      setError("Unable to contact the identity service.");
    } finally {
      setBusy(false);
    }
  }
  async function unlink(accountId: string) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/accounts/unlink", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId }),
      });
      const result: { error?: string } = await response.json();
      if (!response.ok) setError(result.error ?? "Unable to unlink account.");
      else setRevision((value) => value + 1);
    } catch {
      setError("Unable to unlink account.");
    } finally {
      setBusy(false);
    }
  }
  const telegramAccounts = accounts.filter((account) => account.providerId === "telegram");
  return (
    <div className="min-h-screen">
      <header className="border-b bg-card">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-5 sm:px-8">
          <a
            href="/"
            className="flex items-center gap-3 text-foreground"
            aria-label="PoliNetwork Identity home"
          >
            <img src="/polinetwork-logo.svg" width={40} height={40} alt="" className="size-10" />
            <span className="font-bold tracking-tight">
              PoliNetwork <span className="ml-1 font-normal text-muted-foreground">Identity</span>
            </span>
          </a>
          <ThemeSwitch />
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-5 py-10 sm:px-8 sm:py-14">
        <div className="mb-9 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">
              {session ? "Your place in PoliNetwork." : "Your PoliNetwork starts here."}
            </h1>
            <p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground">
              {session
                ? "Your accounts, your membership. Together in one place."
                : "Sign in to bring your accounts and university identity together."}
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
                  {session ? (
                    <UserAvatar name={session.user.name} image={session.user.image} />
                  ) : (
                    <UserRound className="size-7" aria-hidden="true" />
                  )}
                </div>
                <h2 className="mt-5 break-words text-2xl font-bold tracking-tight">
                  {isPending ? "Loading…" : (session?.user.name ?? "One community. Your identity.")}
                </h2>
                <p className="mt-2 text-sm leading-6 text-blue-100">
                  {session ? "Your PoliNetwork identity" : "For the people who make PoliNetwork."}
                </p>
                <div
                  className="mt-8 flex min-h-9 flex-wrap gap-2 border-t border-white/25 pt-5"
                  aria-live="polite"
                >
                  {session && identity?.states.length ? (
                    identity.states.map((state) => (
                      <Badge key={state} className="border-white/30 bg-white/15 text-white">
                        <BadgeCheck className="size-3.5" />
                        {state === "socio" ? "Socio PN" : "Polimi student"}
                      </Badge>
                    ))
                  ) : (
                    <p className="text-xs leading-5 text-blue-100">
                      {isPending || (session && !identity)
                        ? "Loading your identity…"
                        : session
                          ? "Link your accounts to add membership and student status."
                          : "Sign in to create your identity."}
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
            {session && (
              <Button
                variant="ghost"
                className="text-muted-foreground"
                onClick={async () => {
                  const result = await authClient.signOut();
                  if (result.error) setError(result.error.message ?? "Unable to sign out.");
                }}
              >
                <LogOut />
                Sign out
              </Button>
            )}
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
                          variant={session ? "outline" : "default"}
                          disabled={busy || isPending || !providers.signIn.includes(option.id)}
                          onClick={() => void connect(option.id)}
                        >
                          {!providers.signIn.includes(option.id)
                            ? "Unavailable"
                            : session
                              ? "Link account"
                              : "Continue"}
                        </Button>
                      ) : (
                        linked.map((account) => (
                          <Button
                            key={account.id}
                            variant="destructive"
                            size="sm"
                            disabled={busy || loginAccountCount < 2}
                            onClick={() => void unlink(account.id)}
                          >
                            <Unlink className="size-3.5" />
                            Unlink
                          </Button>
                        ))
                      )}
                    </div>
                  );
                })}
              </CardContent>
            </Card>
            <PasskeyCard />
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
                        Linked{identity?.telegramId ? ` · ${identity.telegramId}` : ""}
                      </p>
                    )}
                    {!session && (
                      <p className="mt-2 text-xs text-muted-foreground">
                        Sign in first to link Telegram.
                      </p>
                    )}
                  </div>
                  {session && !telegramAccounts.length && (
                    <Button
                      variant="outline"
                      disabled={busy || !providers.link.includes("telegram")}
                      onClick={() => void connect("telegram")}
                    >
                      {providers.link.includes("telegram") ? "Link account" : "Unavailable"}
                    </Button>
                  )}
                  {telegramAccounts.map((account) => (
                    <Button
                      key={account.id}
                      variant="destructive"
                      size="sm"
                      disabled={busy}
                      onClick={() => void unlink(account.id)}
                    >
                      <Unlink className="size-3.5" />
                      Unlink
                    </Button>
                  ))}
                </section>
                <StudentVerificationForm
                  configured={providers.link.includes("polimi-email")}
                  signedIn={!!session}
                  linkedAccount={accounts.find((account) => account.providerId === "polimi-email")}
                  verified={identity?.states.includes("student") ?? false}
                  canUnlink={!!session && !busy}
                  onChanged={() => setRevision((value) => value + 1)}
                  onUnlink={unlink}
                />
              </CardContent>
            </Card>
          </div>
        </div>
        <footer className="mt-12 flex flex-wrap items-start justify-between gap-4 border-t pt-6 text-xs leading-5 text-muted-foreground">
          <p>PoliNetwork APS</p>
          <p className="max-w-md sm:text-right">
            Identity is in preview. Existing PoliNetwork services still use their current sign-in.
          </p>
        </footer>
      </main>
    </div>
  );
}
