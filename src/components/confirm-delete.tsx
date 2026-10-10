import { useState, type ReactNode } from "react";
import { LoaderCircle, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/** A delete button that asks first in a dialog rather than the browser's own popup. */
export function ConfirmDelete({
  label,
  title,
  description,
  busy,
  disabled,
  onConfirm,
}: {
  label: string;
  title: string;
  description: ReactNode;
  busy: boolean;
  disabled?: boolean;
  /** Closes the dialog once it resolves; on failure the caller shows the error. */
  onConfirm: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button variant="destructive" disabled={disabled || busy} onClick={() => setOpen(true)}>
        <Trash2 aria-hidden="true" />
        {label}
      </Button>
      <Dialog open={open} onOpenChange={(next) => !busy && setOpen(next)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" disabled={busy} onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={() => void onConfirm().finally(() => setOpen(false))}
            >
              {busy ? (
                <LoaderCircle className="animate-spin" aria-hidden="true" />
              ) : (
                <Trash2 aria-hidden="true" />
              )}
              {label}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
