import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { authClient } from "@/auth/client";
import { type identityClaims, isLoginProvider } from "@/auth/policy";
import { StudentVerificationForm } from "@/components/student-verification-form";
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
  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <p className="text-sm font-semibold text-blue-600">PoliNetwork · Identity prototype</p>
      <h1 className="mt-3 text-4xl font-bold">
        {session ? "Your PoliNetwork identity" : "One account for PoliNetwork"}
      </h1>
      <p className="mt-4 text-slate-600">
        This service is under development. Existing PoliNetwork services still use the backend
        sign-in.
      </p>
      {isPending && (
        <p role="status" className="mt-6">
          Loading your session…
        </p>
      )}
      {error && (
        <p role="alert" className="my-6 rounded border border-red-300 p-4 text-red-700">
          {error}
        </p>
      )}
      {session && (
        <section className="my-8 rounded-xl border p-6">
          <h2 className="text-xl font-semibold">{session.user.name}</h2>
          <p className="mt-2">Verified states: {identity?.states.join(", ") || "None"}</p>
          {identity?.telegramId && <p>Telegram ID: {identity.telegramId}</p>}
          <p className="mt-2 text-sm text-slate-600">
            PoliNetwork membership is checked automatically.
          </p>
          <button
            className="mt-4 underline"
            onClick={async () => {
              const result = await authClient.signOut();
              if (result.error) setError(result.error.message ?? "Unable to sign out.");
            }}
          >
            Sign out
          </button>
        </section>
      )}
      <div className="mt-8 grid gap-4">
        {signInOptions.map((option) => {
          const linked = accounts.filter((account) => account.providerId === option.id);
          return (
            <section key={option.id} className="rounded-xl border border-slate-200 p-6">
              <h2 className="text-xl font-semibold">{option.name}</h2>
              <p className="mt-2 text-slate-600">{option.description}</p>
              {linked.length === 0 ? (
                <button
                  disabled={busy || isPending || !providers.signIn.includes(option.id)}
                  onClick={() => void connect(option.id)}
                  className="mt-4 rounded-lg bg-blue-700 px-4 py-2 text-white disabled:opacity-40"
                >
                  {!providers.signIn.includes(option.id)
                    ? "Not configured"
                    : session
                      ? "Link account"
                      : "Continue"}
                </button>
              ) : (
                <p className="mt-4 text-sm text-slate-600">Linked</p>
              )}
              {linked.map((account) => (
                <Button
                  variant="destructive"
                  key={account.accountId}
                  disabled={busy || loginAccountCount < 2}
                  onClick={() => void unlink(account.id)}
                  className="mt-3"
                >
                  Unlink
                </Button>
              ))}
              {linked.length > 0 && loginAccountCount < 2 && (
                <p className="mt-2 text-sm text-slate-600">
                  Link another login account before unlinking this one.
                </p>
              )}
            </section>
          );
        })}
        <section className="rounded-xl border border-slate-200 p-6">
          <h2 className="text-xl font-semibold">Telegram</h2>
          <p className="mt-2 text-slate-600">
            Connect Telegram to identify your bot account. Moderation roles remain managed by
            PoliNetwork.
          </p>
          {!session && (
            <p className="mt-4 text-sm text-slate-600">
              Sign in with Google or PoliNetwork before connecting Telegram.
            </p>
          )}
          {session && !accounts.some((account) => account.providerId === "telegram") && (
            <button
              disabled={busy || isPending || !providers.link.includes("telegram")}
              onClick={() => void connect("telegram")}
              className="mt-4 rounded-lg bg-blue-700 px-4 py-2 text-white disabled:opacity-40"
            >
              {!providers.link.includes("telegram") ? "Not configured" : "Link account"}
            </button>
          )}
          {accounts
            .filter((account) => account.providerId === "telegram")
            .map((account) => (
              <div key={account.id}>
                <p className="mt-4 text-sm text-slate-600">Linked</p>
                <Button
                  variant="destructive"
                  key={account.id}
                  disabled={busy}
                  onClick={() => void unlink(account.id)}
                  className="mt-3"
                >
                  Unlink
                </Button>
              </div>
            ))}
        </section>
        <StudentVerificationForm
          configured={providers.link.includes("polimi-email")}
          signedIn={!!session}
          linkedAccount={accounts.find((account) => account.providerId === "polimi-email")}
          canUnlink={!!session}
          onChanged={() => setRevision((value) => value + 1)}
          onUnlink={unlink}
        />
      </div>
      <p className="mt-6 text-sm text-slate-600">
        Google and PoliNetwork are login methods. Telegram and Polimi email only add verified
        information to your signed-in account.
      </p>
    </main>
  );
}
