import { useId, useState } from "react";
import { LoaderCircle } from "lucide-react";
import {
  MAX_DESCRIPTION_LENGTH,
  MAX_NAME_LENGTH,
  type PermissionDraft,
  type RbacCatalog,
  type RbacDraftErrors,
  expandPermissionKeys,
  hasDraftErrors,
  normalizePermissionDraft,
  permissionImplicationWouldCycle,
  validatePermissionDraft,
} from "@/auth/rbac";
import { Field, KeyChip } from "@/components/rbac/fields";
import { PickList } from "@/components/rbac/pick-list";
import { useDraftErrors } from "@/components/rbac/use-draft-errors";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export function PermissionForm({
  mode,
  initial,
  catalog,
  currentKey,
  managed,
  readOnly,
  busy,
  serverErrors,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  mode: "create" | "edit";
  initial: PermissionDraft;
  catalog: RbacCatalog;
  /** The stored key when editing, so self-reference and cycles can be ruled out. */
  currentKey?: string;
  /** Built-in permissions keep their key: the identity provider checks for it by name. */
  managed?: boolean;
  /** Shown to someone who may see permissions but not change them. */
  readOnly?: boolean;
  busy: boolean;
  serverErrors?: RbacDraftErrors;
  submitLabel: string;
  onSubmit: (draft: PermissionDraft) => void;
  onCancel?: () => void;
}) {
  const [draft, setDraft] = useState(initial);
  const [touched, setTouched] = useState(false);
  const ids = { key: useId(), name: useId(), description: useId() };
  const local = validatePermissionDraft(normalizePermissionDraft(draft), { catalog, currentKey });
  const { serverFieldErrors, noteEdited } = useDraftErrors(serverErrors);
  const errors: RbacDraftErrors = { ...serverFieldErrors, ...(touched ? local : {}) };
  const change = (patch: Partial<PermissionDraft>) => {
    noteEdited(Object.keys(patch));
    setDraft((prev) => ({ ...prev, ...patch }));
  };

  const options = catalog.permissions
    .filter((entry) => entry.key !== (currentKey ?? draft.key.trim().toLowerCase()))
    .map((entry) => {
      const cycles = currentKey
        ? permissionImplicationWouldCycle(catalog, currentKey, entry.key)
        : false;
      return {
        key: entry.key,
        label: entry.name,
        hint: entry.description ?? undefined,
        disabled: cycles,
        disabledReason: `${entry.name} already grants this permission.`,
      };
    });

  // What a holder ends up with, so the effect of the hierarchy is visible before saving.
  const effective = expandPermissionKeys(catalog, draft.implies).filter(
    (key) => !draft.implies.includes(key),
  );

  return (
    <form
      noValidate
      className="space-y-8"
      onSubmit={(event) => {
        event.preventDefault();
        setTouched(true);
        if (hasDraftErrors(local)) return;
        onSubmit(normalizePermissionDraft(draft));
      }}
    >
      <fieldset disabled={readOnly} className="space-y-8 border-0 p-0">
        <div className="grid gap-6 sm:grid-cols-2">
          <Field
            id={ids.name}
            label="Name"
            hint={`What this lets someone do, in plain language. Up to ${MAX_NAME_LENGTH} characters.`}
            error={errors.name}
          >
            <Input
              id={ids.name}
              value={draft.name}
              maxLength={MAX_NAME_LENGTH}
              aria-invalid={!!errors.name}
              placeholder="Read the member list"
              onChange={(event) => change({ name: event.target.value })}
            />
          </Field>
          <Field
            id={ids.key}
            label="Key"
            hint={
              managed
                ? "This permission is defined by the identity provider, so its key is fixed."
                : mode === "create"
                  ? "How applications ask for it, for example membership:read."
                  : "Changing the key changes what applications must check for."
            }
            error={errors.key}
          >
            <Input
              id={ids.key}
              value={draft.key}
              maxLength={64}
              disabled={managed}
              aria-invalid={!!errors.key}
              className="font-mono"
              placeholder="membership:read"
              onChange={(event) => change({ key: event.target.value })}
            />
          </Field>
        </div>
        <Field
          id={ids.description}
          label="Description"
          hint="Optional. Shown to whoever assigns this permission to a role."
          error={errors.description}
        >
          <Textarea
            id={ids.description}
            value={draft.description}
            maxLength={MAX_DESCRIPTION_LENGTH}
            rows={2}
            aria-invalid={!!errors.description}
            onChange={(event) => change({ description: event.target.value })}
          />
        </Field>

        <PickList
          legend="Also grants"
          description="Anyone holding this permission holds these too. Use it for a broader permission that covers narrower ones, such as a write permission that includes read."
          options={options}
          selected={draft.implies}
          onChange={(implies) => change({ implies })}
          emptyText="There are no other permissions yet."
          error={errors.implies}
        />
      </fieldset>
      {effective.length > 0 && (
        <p className="text-xs leading-5 text-muted-foreground">
          Through those, it also grants{" "}
          {effective.map((key, index) => (
            <span key={key}>
              {index > 0 && ", "}
              <KeyChip>{key}</KeyChip>
            </span>
          ))}
          .
        </p>
      )}

      {readOnly ? null : (
        <div className="flex flex-col-reverse gap-3 border-t pt-6 sm:flex-row sm:justify-end">
          {onCancel && (
            <Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>
              Cancel
            </Button>
          )}
          <Button type="submit" disabled={busy}>
            {busy && <LoaderCircle className="animate-spin" aria-hidden="true" />}
            {submitLabel}
          </Button>
        </div>
      )}
    </form>
  );
}
