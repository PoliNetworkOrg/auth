import { useEffect, useState, type ReactNode } from "react";
import { Building2, Fingerprint, LoaderCircle } from "lucide-react";
import { authClient } from "@/auth/client";
import { ThemeSwitch } from "@/components/theme-switch";
import { GoogleIcon } from "@/components/google-icon";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";

const providers = [
  { id: "google", name: "Google" },
  { id: "pn-entra", name: "PoliNetwork APS" },
];

export function LoginLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-svh flex-col bg-muted">
      <header className="flex justify-end p-5 sm:p-6">
        <ThemeSwitch />
      </header>
      <main className="flex flex-1 items-center justify-center px-5 pb-20 pt-6 sm:px-6">
        <div className="flex w-full max-w-sm flex-col gap-6">
          <a
            href="/"
            className="flex items-center gap-3 self-center rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="PoliNetwork Identity home"
          >
            <img src="/polinetwork-logo.svg" width={36} height={36} alt="" className="size-9" />
            <span className="font-bold tracking-tight">
              PoliNetwork <span className="font-normal text-muted-foreground">Identity</span>
            </span>
          </a>
          {children}
          <p className="text-center text-xs leading-5 text-muted-foreground">PoliNetwork APS</p>
        </div>
      </main>
    </div>
  );
}

export function LoginPage() {
  const [available, setAvailable] = useState<string[] | null>(null);
  const [providerError, setProviderError] = useState(false);
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [passkeySupported, setPasskeySupported] = useState(false);

  useEffect(() => {
    setPasskeySupported(window.isSecureContext && !!window.PublicKeyCredential);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    async function loadProviders() {
      setProviderError(false);
      const response = await fetch("/api/providers", { signal: controller.signal });
      if (!response.ok) throw new Error("Unable to load sign-in methods.");
      const result: { signIn: string[] } = await response.json();
      setAvailable(result.signIn);
    }
    void loadProviders().catch(() => {
      if (!controller.signal.aborted) setProviderError(true);
    });
    return () => controller.abort();
  }, [revision]);

  async function signIn(method: string) {
    setBusy(method);
    setError("");
    try {
      const result =
        method === "passkey"
          ? await authClient.signIn.passkey()
          : await authClient.signIn.social({ provider: method, callbackURL: "/" });
      if (result.error) {
        setError(
          method === "passkey"
            ? "Passkey sign-in was not completed. Try again or continue with your account below."
            : (result.error.message ?? "Sign-in failed. Please try again."),
        );
      }
    } catch {
      setError("Unable to reach the sign-in service. Please try again.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <LoginLayout>
      <Card>
        <CardHeader className="pb-6 pt-8 text-center">
          <h1 className="text-2xl font-bold tracking-tight">Welcome back</h1>
          <CardDescription>Sign in to your PoliNetwork account</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6 pb-8">
          <form
            className="space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              if (!busy && passkeySupported) void signIn("passkey");
            }}
            aria-label="Passkey sign-in"
          >
            <Button
              type="submit"
              className="h-11 w-full"
              disabled={!!busy || !passkeySupported}
              aria-describedby="passkey-help"
            >
              {busy === "passkey" ? (
                <LoaderCircle className="animate-spin" aria-hidden="true" />
              ) : (
                <Fingerprint aria-hidden="true" />
              )}
              {busy === "passkey" ? "Waiting for your passkey…" : "Sign in with a passkey"}
            </Button>
            <p id="passkey-help" className="text-center text-xs leading-5 text-muted-foreground">
              {passkeySupported
                ? "Use a passkey you've already added to your account."
                : "Passkeys aren't available in this browser. Use an account below."}
            </p>
          </form>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className="h-px flex-1 bg-border" />
            <span>Or continue with</span>
            <span className="h-px flex-1 bg-border" />
          </div>
          <div className="space-y-3">
            {providers
              .filter((provider) => available?.includes(provider.id))
              .map((provider) => (
                <Button
                  key={provider.id}
                  type="button"
                  variant="outline"
                  className="h-11 w-full bg-card"
                  disabled={!!busy}
                  onClick={() => void signIn(provider.id)}
                >
                  {busy === provider.id ? (
                    <LoaderCircle className="animate-spin" aria-hidden="true" />
                  ) : provider.id === "google" ? (
                    <GoogleIcon />
                  ) : (
                    <Building2 aria-hidden="true" />
                  )}
                  Continue with {provider.name}
                </Button>
              ))}
            {providerError ? (
              <div className="space-y-2 text-center">
                <p role="alert" className="text-sm">
                  Unable to load account sign-in methods.
                </p>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setRevision((value) => value + 1)}
                >
                  Try again
                </Button>
              </div>
            ) : available === null ? (
              <p role="status" className="text-center text-sm text-muted-foreground">
                Loading sign-in methods…
              </p>
            ) : available.length === 0 ? (
              <p className="text-center text-sm text-muted-foreground">
                Account sign-in is currently unavailable.
              </p>
            ) : null}
          </div>
          {error && (
            <p
              role="alert"
              className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm leading-6"
            >
              {error}
            </p>
          )}
          <p className="text-center text-xs leading-5 text-muted-foreground">
            New here? Continue with an account to get started. You can add a passkey once you're
            signed in.
          </p>
        </CardContent>
      </Card>
    </LoginLayout>
  );
}
