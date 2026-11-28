import { useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { BadgeCheck, PencilLine, UserRound } from "lucide-react";
import { toast } from "sonner";
import type { AccountDetails } from "@/auth/account.functions";
import { NAME_EDIT_LIMIT, NAME_EDIT_WINDOW_DAYS } from "@/auth/names";
import { NameForm } from "@/components/name-form";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Hint } from "@/components/ui/tooltip";

function formatDay(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "long" });
}

/**
 * Under the person's name: managed by PoliNetwork APS, or an **Edit name** button for a
 * self-declared name, limited to `NAME_EDIT_LIMIT` changes in `NAME_EDIT_WINDOW_DAYS`.
 */
export function NameStatus({ name }: { name: AccountDetails["name"] }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);

  if (name.managed)
    return (
      <p className="mt-1 flex items-center gap-1.5 text-[13px] text-muted-foreground">
        <BadgeCheck className="size-4 text-primary" aria-hidden="true" />
        Name managed by PoliNetwork APS
      </p>
    );

  const blocked = name.editsLeft === 0 && name.nextEditAt !== null;
  return (
    <>
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-muted-foreground">
        <span>Self-declared name</span>
        <Hint
          content={
            blocked ? `You can change it again on ${formatDay(name.nextEditAt!)}` : undefined
          }
        >
          <span className="inline-block">
            <Button
              variant="ghost"
              size="sm"
              className="-ml-2 h-7 px-2 text-[13px]"
              disabled={blocked}
              onClick={() => setEditing(true)}
            >
              <PencilLine aria-hidden="true" />
              Edit name
            </Button>
          </span>
        </Hint>
      </div>
      <Dialog open={editing} onOpenChange={setEditing}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit your name</DialogTitle>
            <DialogDescription>
              Your real first and last name. You can change it {NAME_EDIT_LIMIT} times in{" "}
              {NAME_EDIT_WINDOW_DAYS} days
              {name.editsLeft < NAME_EDIT_LIMIT ? `; ${name.editsLeft} left for now` : ""}.
              Administrators can see every change.
            </DialogDescription>
          </DialogHeader>
          <NameForm
            initial={{ givenName: name.givenName, familyName: name.familyName }}
            submitLabel="Save"
            onSaved={async (changed) => {
              if (changed) {
                await router.invalidate({ sync: true });
                toast.success("Your name is saved.");
              } else toast("Your name is unchanged.");
              setEditing(false);
            }}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * For someone whose self-declared name was never confirmed and who signed in here directly:
 * applications ask at sign-in (`/setup`), the account page asks here.
 */
export function ConfirmNameCard({ name }: { name: AccountDetails["name"] }) {
  const router = useRouter();
  return (
    <section className="rounded-2xl border border-primary/30 bg-primary/5 px-5 py-5 sm:px-6">
      <div className="mb-4 flex items-start gap-3">
        <UserRound className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden="true" />
        <div>
          <h2 className="text-base font-semibold tracking-tight">Confirm your name</h2>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            Write your real first and last name, as on your ID. PoliNetwork's administrators and the
            applications you use will see it, marked as declared by you.
          </p>
        </div>
      </div>
      <NameForm
        initial={{ givenName: name.givenName, familyName: name.familyName }}
        submitLabel="Confirm"
        onSaved={async () => {
          await router.invalidate({ sync: true });
          toast.success("Your name is confirmed.");
        }}
      />
    </section>
  );
}
