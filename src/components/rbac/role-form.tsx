import { useId, useState } from "react";
import { LoaderCircle } from "lucide-react";
import {
  MAX_DESCRIPTION_LENGTH,
  MAX_NAME_LENGTH,
  type RbacCatalog,
  type RbacDraftErrors,
  type RoleDraft,
  hasDraftErrors,
  normalizeRoleDraft,
  resolveAccess,
  roleParentWouldCycle,
  validateRoleDraft,
} from "@/auth/rbac";
import { Field, KeyChip } from "@/components/rbac/fields";
import { PickList } from "@/components/rbac/pick-list";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export function RoleForm({
  mode,
  initial,
  catalog,
  currentKey,
  managed,
  grantsEverything,
  readOnly,
  busy,
  serverErrors,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  mode: "create" | "edit";
  initial: RoleDraft;
  catalog: RbacCatalog;
  currentKey?: string;
  /** Built-in roles keep their key: it is what ties them to the evidence that grants them. */
  managed?: boolean;
  /** Master Admin holds every permission, so it has no grant list of its own to edit. */
  grantsEverything?: boolean;
  /** Shown to someone who may see roles but not change them. */
  readOnly?: boolean;
  busy: boolean;
  serverErrors?: RbacDraftErrors;
  submitLabel: string;
  onSubmit: (draft: RoleDraft) => void;
  onCancel?: () => void;
}) {
  const [draft, setDraft] = useState(initial);
  const [touched, setTouched] = useState(false);
  const ids = { key: useId(), name: useId(), description: useId() };
  const local = validateRoleDraft(normalizeRoleDraft(draft), { catalog, currentKey });
  const errors: RbacDraftErrors = touched ? local : { ...serverErrors };
  const change = (patch: Partial<RoleDraft>) => setDraft((prev) => ({ ...prev, ...patch }));

  const parentOptions = catalog.roles
    .filter((entry) => entry.key !== (currentKey ?? draft.key.trim().toLowerCase()))
    .map((entry) => {
      const cycles = currentKey ? roleParentWouldCycle(catalog, currentKey, entry.key) : false;
      return {
        key: entry.key,
        label: entry.name,
        hint: entry.description ?? undefined,
        disabled: cycles,
        disabledReason: `${entry.name} already inherits from this role.`,
      };
    });

  const permissionOptions = catalog.permissions.map((entry) => ({
    key: entry.key,
    label: entry.name,
    hint: entry.description ?? undefined,
  }));

  // Everything a holder would end up with once both hierarchies are followed.
  const preview = resolveAccess(
    {
      ...catalog,
      roles: [
        ...catalog.roles.filter((entry) => entry.key !== (currentKey ?? "")),
        {
          id: "preview",
          key: "preview",
          name: draft.name,
          description: null,
          managed: false,
          sourceState: null,
          permissions: draft.permissions,
          parents: draft.parents,
          memberCount: 0,
          createdAt: null,
          updatedAt: null,
        },
      ],
    },
    ["preview"],
  );
  const inherited = preview.permissions.filter((key) => !draft.permissions.includes(key));

  return (
    <form
      noValidate
      className="space-y-8"
      onSubmit={(event) => {
        event.preventDefault();
        setTouched(true);
        if (hasDraftErrors(local)) return;
        onSubmit(normalizeRoleDraft(draft));
      }}
    >
      <fieldset disabled={readOnly} className="space-y-8 border-0 p-0">
        <div className="grid gap-6 sm:grid-cols-2">
          <Field
            id={ids.name}
            label="Name"
            hint={`What to call this role. Up to ${MAX_NAME_LENGTH} characters.`}
            error={errors.name}
          >
            <Input
              id={ids.name}
              value={draft.name}
              maxLength={MAX_NAME_LENGTH}
              aria-invalid={!!errors.name}
              placeholder="Group moderator"
              onChange={(event) => change({ name: event.target.value })}
            />
          </Field>
          <Field
            id={ids.key}
            label="Key"
            hint={
              managed
                ? "This role is defined by the identity provider, so its key is fixed."
                : mode === "create"
                  ? "How applications see the role, for example group-moderator."
                  : "Changing the key changes what applications see in the roles claim."
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
              placeholder="group-moderator"
              onChange={(event) => change({ key: event.target.value })}
            />
          </Field>
        </div>
        <Field
          id={ids.description}
          label="Description"
          hint="Optional. Explains who this role is for."
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

        {grantsEverything ? (
          <p className="rounded-xl border bg-muted/40 p-4 text-sm leading-6">
            This role holds every permission that exists, including ones created later, so it has no
            grant list of its own.
          </p>
        ) : (
          <>
            <PickList
              legend="Permissions"
              description="Granted to everyone who holds this role."
              options={permissionOptions}
              selected={draft.permissions}
              onChange={(permissions) => change({ permissions })}
              emptyText="Create a permission first."
              error={errors.permissions}
            />

            <PickList
              legend="Inherits from"
              description="This role also carries every permission of the roles you pick here, including what those inherit in turn."
              options={parentOptions}
              selected={draft.parents}
              onChange={(parents) => change({ parents })}
              emptyText="There are no other roles yet."
              error={errors.parents}
            />
          </>
        )}
      </fieldset>
      {inherited.length > 0 && !grantsEverything && (
        <div className="rounded-xl border bg-muted/40 p-4">
          <h3 className="text-sm font-medium">Also carries, through inheritance</h3>
          <p className="mt-2 flex flex-wrap gap-1.5">
            {inherited.map((key) => (
              <KeyChip key={key}>{key}</KeyChip>
            ))}
          </p>
        </div>
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
