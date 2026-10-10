import { useState } from "react";
import { LoaderCircle, Trash2 } from "lucide-react";
import { deleteUserFn } from "@/auth/users.functions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { errorMessage } from "@/lib/action-error";

/**
 * Permanently deletes someone, behind a dialog that asks for their name. The server repeats
 * every check, including the name, so this only keeps the UI honest.
 */
export function DeleteUser({
  userId,
  userName,
  isSelf,
  onDeleted,
}: {
  userId: string;
  userName: string;
  isSelf: boolean;
  /** Leaves the page; the button stays busy until it resolves. */
  onDeleted: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const matches = confirm.trim() === userName.trim();

  async function remove() {
    setBusy(true);
    setError("");
    try {
      await deleteUserFn({ data: { userId, confirm } });
    } catch (cause) {
      setError(errorMessage(cause, "Unable to delete this person."));
      setBusy(false);
      return;
    }
    await onDeleted();
  }

  return (
    <Card className="border-destructive/40">
      <CardHeader>
        <CardTitle>Delete this account</CardTitle>
        <CardDescription>
          {isSelf
            ? "You cannot delete your own account."
            : "Removes the person and their linked accounts, passkeys, sessions, and roles. Applications cannot refresh their access, and tokens already issued expire within minutes. This cannot be undone."}
        </CardDescription>
      </CardHeader>
      {!isSelf && (
        <CardContent>
          <Button
            variant="destructive"
            onClick={() => {
              setConfirm("");
              setError("");
              setOpen(true);
            }}
          >
            <Trash2 aria-hidden="true" />
            Delete account
          </Button>
        </CardContent>
      )}
      <Dialog open={open} onOpenChange={(next) => !busy && setOpen(next)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {userName}?</DialogTitle>
            <DialogDescription>
              Everything tied to this account is removed permanently. If they sign in again they
              start over as a new person, without their roles or verified status.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="delete-user-confirm">Type their name to confirm</Label>
            <Input
              id="delete-user-confirm"
              value={confirm}
              autoComplete="off"
              placeholder={userName}
              onChange={(event) => setConfirm(event.target.value)}
            />
          </div>
          {error && (
            <p
              role="alert"
              className="rounded-xl border border-destructive bg-destructive/5 p-3 text-sm"
            >
              {error}
            </p>
          )}
          <DialogFooter>
            <Button variant="ghost" disabled={busy} onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" disabled={!matches || busy} onClick={() => void remove()}>
              {busy ? (
                <LoaderCircle className="animate-spin" aria-hidden="true" />
              ) : (
                <Trash2 aria-hidden="true" />
              )}
              Delete permanently
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
