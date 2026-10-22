import { useId, useState } from "react";
import { LoaderCircle } from "lucide-react";
import {
  MASTER_ADMIN_ROLE_KEY,
  MAX_DESCRIPTION_LENGTH,
  MAX_NAME_LENGTH,
  type RbacCatalog,
  type RbacDraftErrors,
  type RoleDraft,
  hasDraftErrors,
  normalizeRoleDraft,
  roleDraftPermissions,
  effectiveRolePermissions,
  intrinsicImplications,
  toggleRoleDraftPermission,
  roleParentWouldCycle,
  validateRoleDraft,
} from "@/auth/rbac";
import { Field } from "@/components/rbac/fields";
import { useAccess } from "@/components/access";
import { canGrantPermission, canGrantRole } from "@/components/rbac/delegation";
import { PickList } from "@/components/rbac/pick-list";
import { useDraftErrors } from "@/components/rbac/use-draft-errors";
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
  const access = useAccess();
  const [draft, setDraft] = useState(initial);
  const [touched, setTouched] = useState(false);
  const ids = { key: useId(), name: useId(), description: useId() };
  const local = validateRoleDraft(normalizeRoleDraft(draft), { catalog, currentKey });
  const { serverFieldErrors, noteEdited } = useDraftErrors(serverErrors);
  const errors: RbacDraftErrors = { ...serverFieldErrors, ...(touched ? local : {}) };
  const change = (patch: Partial<RoleDraft>) => {
    noteEdited(Object.keys(patch));
    setDraft((prev) => ({ ...prev, ...patch }));
  };

  const parentOptions = catalog.roles
    .filter((entry) => entry.key !== (currentKey ?? draft.key.trim().toLowerCase()))
    .filter(
      (entry) => canGrantRole(access, catalog, entry.key) || draft.parents.includes(entry.key),
    )
    .map((entry) => {
      const cycles = currentKey ? roleParentWouldCycle(catalog, currentKey, entry.key) : false;
      const wildcard = entry.key === MASTER_ADMIN_ROLE_KEY;
      const outsideAuthority = !canGrantRole(access, catalog, entry.key);
      return {
        key: entry.key,
        label: entry.name,
        hint: entry.description ?? undefined,
        disabled: cycles || wildcard || outsideAuthority,
        disabledReason: wildcard
          ? `${entry.name} holds every permission and is granted only by this deployment's configuration, so no role can inherit from it.`
          : outsideAuthority
            ? "This role grants permissions you do not hold."
            : `${entry.name} already inherits from this role.`,
      };
    });

  const preview = roleDraftPermissions(catalog, draft, currentKey);
  const inherited = roleDraftPermissions(
    catalog,
    {
      ...draft,
      permissions: [],
      deniedPermissions: [],
    },
    currentKey,
  );
  const denied = draft.deniedPermissions ?? [];
  const permissionOptions = catalog.permissions
    .filter(
      (entry) =>
        canGrantPermission(access, catalog, entry.key) ||
        preview.includes(entry.key) ||
        denied.includes(entry.key),
    )
    .map((entry) => {
      const direct = draft.permissions.includes(entry.key);
      const excluded = denied.includes(entry.key);
      const fromParents = inherited.includes(entry.key);
      const sources = catalog.roles
        .filter(
          (role) =>
            draft.parents.includes(role.key) &&
            effectiveRolePermissions(catalog, role.key).includes(entry.key),
        )
        .map((role) => role.name);
      const requiredBy = catalog.permissions
        .filter(
          (permission) =>
            preview.includes(permission.key) &&
            intrinsicImplications(permission.key).includes(entry.key),
        )
        .map((permission) => permission.name);
      const outsideAuthority = !canGrantPermission(access, catalog, entry.key);
      return {
        key: entry.key,
        label: entry.name,
        hint: entry.description ?? undefined,
        status: excluded
          ? ("Override" as const)
          : direct
            ? ("Direct" as const)
            : fromParents
              ? ("Inherited" as const)
              : preview.includes(entry.key)
                ? ("Implied" as const)
                : undefined,
        statusHint: excluded
          ? requiredBy.length > 0
            ? "This override is inactive because another permission requires this access. Reset the override or remove that permission."
            : fromParents
              ? `Excluded for this role. Inherited from ${sources.join(", ")}.`
              : "Excluded for this role, including future inheritance."
          : fromParents
            ? `${direct ? "Also inherited" : "Inherited"} from ${sources.join(", ")}.`
            : !direct && preview.includes(entry.key)
              ? "Granted by another permission of this role."
              : undefined,
        disabled: outsideAuthority || requiredBy.length > 0,
        disabledReason: outsideAuthority
          ? "You do not hold this permission or everything it grants."
          : `Required by ${requiredBy.join(", ")}. Remove that permission first.`,
        action:
          excluded || (direct && fromParents)
            ? {
                label: fromParents ? "Use inherited" : "Reset override",
                disabled: outsideAuthority,
                onClick: () =>
                  change({
                    permissions: draft.permissions.filter((key) => key !== entry.key),
                    deniedPermissions: denied.filter((key) => key !== entry.key),
                  }),
              }
            : undefined,
      };
    });

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
      {!access.isMasterAdmin && !readOnly && (
        <p className="text-sm text-muted-foreground">
          You can delegate only permissions you already hold. Changes affecting built-in roles or
          access above your own require Master Admin.
        </p>
      )}
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
              aria-describedby={errors.name ? `${ids.name}-error` : `${ids.name}-hint`}
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
              aria-describedby={errors.key ? `${ids.key}-error` : `${ids.key}-hint`}
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
            aria-describedby={
              errors.description ? `${ids.description}-error` : `${ids.description}-hint`
            }
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
              description="Checked permissions are granted by this role. Inherited permissions follow the parent roles; uncheck one to create an override, or use inherited to reset it. Direct permissions are assigned to this role. Other roles held independently can still grant an excluded permission."
              options={permissionOptions}
              selected={preview}
              onChange={(permissions) => {
                const key =
                  preview.find((key) => !permissions.includes(key)) ??
                  permissions.find((key) => !preview.includes(key));
                if (key) {
                  const next = toggleRoleDraftPermission(
                    catalog,
                    draft,
                    key,
                    permissions.includes(key),
                    currentKey,
                  );
                  change({
                    permissions: next.permissions,
                    deniedPermissions: next.deniedPermissions,
                  });
                }
              }}
              emptyText="Create a permission first."
              error={errors.permissions}
            />

            <PickList
              legend="Inherits from"
              description="Permissions follow these roles, including their inheritance and overrides. This role can override individual permissions above."
              options={parentOptions}
              selected={draft.parents}
              onChange={(parents) => change({ parents })}
              emptyText="There are no other roles yet."
              error={errors.parents}
            />
          </>
        )}
      </fieldset>

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
