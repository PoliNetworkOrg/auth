import { useId, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { saveNameFn } from "@/auth/account.functions";
import { NAME_PART_MAX_LENGTH, namePartProblem, type PersonName } from "@/auth/names";
import { Spinner } from "@/components/account/panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { errorFields, errorMessage } from "@/lib/action-error";

type Fields = { givenName?: string; familyName?: string };

/**
 * First and last name, checked here as the server checks them, saved through `saveNameFn`.
 * Calls `onSaved` once the name is stored; the caller moves on from there, and returns true
 * while the page leaves, so the form stays busy.
 */
export function NameForm({
  initial,
  submitLabel,
  onSaved,
  footer,
}: {
  initial: PersonName;
  submitLabel: string;
  onSaved: () => Promise<boolean | void> | boolean | void;
  footer?: ReactNode;
}) {
  const id = useId();
  const [name, setName] = useState(initial);
  const [errors, setErrors] = useState<Fields>({});
  const [busy, setBusy] = useState(false);

  async function submit() {
    const local: Fields = {
      givenName: namePartProblem(name.givenName, "first name") ?? undefined,
      familyName: namePartProblem(name.familyName, "last name") ?? undefined,
    };
    setErrors(local);
    if (local.givenName || local.familyName) return;
    setBusy(true);
    try {
      await saveNameFn({ data: name });
      if (await onSaved()) return;
    } catch (cause) {
      const fields = errorFields<Fields>(cause);
      if (fields) setErrors(fields);
      toast.error(errorMessage(cause, "Your name wasn't saved. Try again."));
    }
    setBusy(false);
  }

  const field = (key: keyof PersonName, label: string, autoComplete: string) => (
    <div className="grid gap-1.5">
      <label htmlFor={`${id}-${key}`} className="text-sm font-medium">
        {label}
      </label>
      <Input
        id={`${id}-${key}`}
        autoComplete={autoComplete}
        maxLength={NAME_PART_MAX_LENGTH + 20}
        value={name[key]}
        aria-invalid={errors[key] ? true : undefined}
        aria-describedby={errors[key] ? `${id}-${key}-error` : undefined}
        onChange={(event) => {
          const value = event.target.value;
          setName((current) => ({ ...current, [key]: value }));
          setErrors((current) => ({ ...current, [key]: undefined }));
        }}
        disabled={busy}
        className="h-10 text-base sm:text-sm"
      />
      {errors[key] && (
        <p id={`${id}-${key}-error`} className="text-[13px] text-destructive">
          {errors[key]}
        </p>
      )}
    </div>
  );

  return (
    <form
      noValidate
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        {field("givenName", "First name", "given-name")}
        {field("familyName", "Last name", "family-name")}
      </div>
      <Button type="submit" className="h-11 active:scale-[0.97]" disabled={busy}>
        {busy && <Spinner />}
        {submitLabel}
      </Button>
      {footer}
    </form>
  );
}
