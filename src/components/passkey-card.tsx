import { useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { Fingerprint, LoaderCircle, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { authClient } from "@/auth/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type Passkey = { id: string; name: string | null; createdAt: Date };

/** Adding and removing stay in the browser, which WebAuthn needs; the list comes from the loader. */
export function PasskeyCard({ passkeys }: { passkeys: Passkey[] }) {
  const router = useRouter();
  /** "add" or the id of the passkey being removed, so only that button spins. */
  const [busy, setBusy] = useState<string | null>(null);

  async function addPasskey() {
    if (!window.isSecureContext || !window.PublicKeyCredential) {
      toast.error("Passkeys aren't available in this browser. Try another browser or device.");
      return;
    }
    setBusy("add");
    try {
      const result = await authClient.passkey.addPasskey();
      if (result.error)
        toast.error(result.error.message ?? "Unable to add a passkey. Please try again.");
      else {
        await router.invalidate({ sync: true });
        toast.success("Passkey added. You can use it the next time you sign in.");
      }
    } catch {
      toast.error("Unable to add a passkey. Please try again.");
    } finally {
      setBusy(null);
    }
  }

  async function removePasskey(id: string) {
    setBusy(id);
    try {
      const result = await authClient.passkey.deletePasskey({ id });
      if (result.error) toast.error(result.error.message ?? "Unable to remove this passkey.");
      else {
        await router.invalidate({ sync: true });
        toast.success("Passkey removed.");
      }
    } catch {
      toast.error("Unable to remove this passkey. Please try again.");
    } finally {
      setBusy(null);
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
        {passkeys.length ? (
          <ul className="divide-y">
            {passkeys.map((passkey) => (
              <li key={passkey.id} className="flex items-center gap-3 py-3 first:pt-0">
                <Fingerprint className="size-5 shrink-0 text-primary" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <p className="break-words text-sm font-medium">{passkey.name || "Passkey"}</p>
                  <p className="text-xs text-muted-foreground">
                    Added {new Date(passkey.createdAt).toLocaleDateString()}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  disabled={busy !== null}
                  aria-label={`Remove ${passkey.name || "passkey"}`}
                  onClick={() => void removePasskey(passkey.id)}
                >
                  {busy === passkey.id ? (
                    <LoaderCircle className="animate-spin" aria-hidden="true" />
                  ) : (
                    <Trash2 aria-hidden="true" />
                  )}
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">
            Add a passkey to sign in without opening another account.
          </p>
        )}
        <Button variant="outline" disabled={busy !== null} onClick={() => void addPasskey()}>
          {busy === "add" ? (
            <LoaderCircle className="animate-spin" aria-hidden="true" />
          ) : (
            <Plus aria-hidden="true" />
          )}
          Add a passkey
        </Button>
      </CardContent>
    </Card>
  );
}
