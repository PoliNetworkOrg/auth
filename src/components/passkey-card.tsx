import { useState } from "react";
import { Fingerprint, LoaderCircle, Plus, Trash2 } from "lucide-react";
import { authClient } from "@/auth/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function PasskeyCard() {
  const { data: passkeys, isPending, error: loadError, refetch } = authClient.useListPasskeys();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function addPasskey() {
    setError("");
    setMessage("");
    if (!window.isSecureContext || !window.PublicKeyCredential) {
      setError("Passkeys aren't available in this browser. Try another browser or device.");
      return;
    }
    setBusy(true);
    try {
      const result = await authClient.passkey.addPasskey();
      if (result.error)
        setError(result.error.message ?? "Unable to add a passkey. Please try again.");
      else setMessage("Passkey added. You can use it the next time you sign in.");
    } catch {
      setError("Unable to add a passkey. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function removePasskey(id: string) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await authClient.passkey.deletePasskey({ id });
      if (result.error) setError(result.error.message ?? "Unable to remove this passkey.");
      else setMessage("Passkey removed.");
    } catch {
      setError("Unable to remove this passkey. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Passkeys</CardTitle>
        <CardDescription>
          Sign in with your fingerprint, face, device PIN, or security key.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isPending ? (
          <p role="status" className="text-sm text-muted-foreground">
            Loading passkeys…
          </p>
        ) : loadError ? (
          <div className="space-y-2">
            <p role="alert" className="text-sm">
              Unable to load your passkeys.
            </p>
            <Button variant="outline" onClick={() => void refetch()}>
              Try again
            </Button>
          </div>
        ) : passkeys?.length ? (
          <ul className="divide-y">
            {passkeys.map((passkey) => (
              <li key={passkey.id} className="flex items-center gap-3 py-3 first:pt-0">
                <Fingerprint className="size-5 shrink-0 text-primary" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <p className="break-words text-sm font-medium">{passkey.name || "Passkey"}</p>
                  {passkey.createdAt && (
                    <p className="text-xs text-muted-foreground">
                      Added {new Date(passkey.createdAt).toLocaleDateString()}
                    </p>
                  )}
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  disabled={busy}
                  aria-label={`Remove ${passkey.name || "passkey"}`}
                  onClick={() => void removePasskey(passkey.id)}
                >
                  <Trash2 aria-hidden="true" />
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">
            Add a passkey to sign in without opening another account.
          </p>
        )}
        <Button variant="outline" disabled={busy} onClick={() => void addPasskey()}>
          {busy ? (
            <LoaderCircle className="animate-spin" aria-hidden="true" />
          ) : (
            <Plus aria-hidden="true" />
          )}
          Add a passkey
        </Button>
        {error && (
          <p role="alert" className="text-sm">
            {error}
          </p>
        )}
        {message && (
          <p role="status" className="text-sm text-muted-foreground">
            {message}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
