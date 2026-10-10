import { createFileRoute, Link, useNavigate, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
import { ArrowLeft, Sparkles } from "lucide-react";
import {
  type RbacDraftErrors,
  type RoleDraft,
  effectiveRolePermissions,
  roleDraftFrom,
  staticRole,
} from "@/auth/rbac";
import { deleteRoleFn, getCatalog, getRoleMembers, saveRoleFn } from "@/auth/rbac.functions";
import { requireAccess, useAccess } from "@/components/access";
import { ConfirmDelete } from "@/components/confirm-delete";
import { KeyChip } from "@/components/rbac/fields";
import { RoleForm } from "@/components/rbac/role-form";
import { RoleMembers } from "@/components/rbac/role-members";
import { canGrantRole } from "@/components/rbac/delegation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { errorFields, errorMessage } from "@/lib/action-error";

export const Route = createFileRoute("/access/roles/$roleId")({
  // A page of the member list after `after`, so a long list can be paged through and linked.
  validateSearch: z.object({ after: z.string().optional() }),
  beforeLoad: ({ context }) => requireAccess(context.viewer, "idp:roles:read"),
  loaderDeps: ({ search }) => ({ after: search.after }),
  loader: async ({ params, deps }) => {
    const [catalog, members] = await Promise.all([
      getCatalog(),
      getRoleMembers({ data: { roleId: params.roleId, after: deps.after } }),
    ]);
    return { catalog, members };
  },
  component: RoleDetail,
});

function RoleDetail() {
  const { roleId } = Route.useParams();
  const navigate = useNavigate();
  const router = useRouter();
  const access = useAccess();
  const { catalog, members } = Route.useLoaderData();
  const { after } = Route.useSearch();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [fields, setFields] = useState<RbacDraftErrors>();

  const role = catalog.roles.find((entry) => entry.id === roleId);
  const canWrite =
    access.can("idp:roles:write") &&
    !!role &&
    (access.isMasterAdmin || !role.managed) &&
    canGrantRole(access, catalog, role.key);
  // Handing a role out is delegated separately from changing what it grants.
  const canAssign =
    access.can("idp:roles:assign") &&
    !!role &&
    !role.managed &&
    canGrantRole(access, catalog, role.key);

  async function save(draft: RoleDraft) {
    setBusy(true);
    setError("");
    setSaved(false);
    setFields(undefined);
    try {
      await saveRoleFn({ data: { roleId, draft } });
      await router.invalidate({ sync: true });
      setSaved(true);
    } catch (cause) {
      setFields(errorFields(cause));
      setError(errorMessage(cause, "Unable to save the role."));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setError("");
    try {
      await deleteRoleFn({ data: { roleId } });
      await navigate({ to: "/access/roles" });
    } catch (cause) {
      setError(errorMessage(cause, "Unable to delete the role."));
      setBusy(false);
    }
  }

  if (!role) {
    return (
      <div className="mx-auto max-w-lg space-y-4 py-10 text-center">
        <p role="alert">This role no longer exists.</p>
        <div className="flex flex-wrap justify-center gap-3">
          <Button variant="ghost" asChild>
            <Link to="/access/roles">
              <ArrowLeft aria-hidden="true" />
              All roles
            </Link>
          </Button>
        </div>
      </div>
    );
  }

  const inferred = role.managed ? staticRole(role.key) : undefined;
  const grantsEverything = inferred?.grantsAllPermissions ?? false;
  const effective = effectiveRolePermissions(catalog, role.key);

  return (
    <div className="space-y-8">
      <div>
        <Button variant="ghost" size="sm" className="-ml-2 text-muted-foreground" asChild>
          <Link to="/access/roles">
            <ArrowLeft aria-hidden="true" />
            Roles
          </Link>
        </Button>
        <h2 className="mt-3 text-3xl font-extrabold tracking-tight sm:text-4xl">{role.name}</h2>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          <KeyChip>{role.key}</KeyChip>
          <span className="ml-2">
            {grantsEverything
              ? "Holds every permission that exists, including ones created later."
              : `${effective.length} ${effective.length === 1 ? "permission" : "permissions"} in total, including inherited ones.`}
          </span>
        </p>
      </div>

      {inferred && (
        <div className="flex gap-3 rounded-xl border bg-muted/40 p-4 text-sm leading-6">
          <Sparkles className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
          <p>
            <strong className="font-medium">Granted automatically.</strong> {inferred.evidence}{" "}
            Nobody can be given or refused this role by hand.
            {canWrite && " Choose what it grants below."}
          </p>
        </div>
      )}

      {error && (
        <p
          role="alert"
          className="rounded-xl border border-destructive bg-destructive/5 p-4 text-sm"
        >
          {error}
        </p>
      )}
      {saved && !error && (
        <p role="status" className="rounded-xl border bg-card p-4 text-sm">
          Saved. New sign-ins use these permissions immediately; tokens already issued expire within
          minutes.
        </p>
      )}

      <Card>
        <CardContent className="pt-6">
          {access.can("idp:roles:write") && !canWrite && (
            <p className="mb-6 text-sm text-muted-foreground">
              {role.managed
                ? "Only Master Admin can change a built-in role."
                : "This role grants permissions you do not hold. Ask Master Admin to change it or manage its members."}
            </p>
          )}
          <RoleForm
            key={`${role.id}-${role.updatedAt ?? ""}`}
            mode="edit"
            initial={roleDraftFrom(role)}
            catalog={catalog}
            currentKey={role.key}
            managed={role.managed}
            grantsEverything={grantsEverything}
            readOnly={!canWrite}
            busy={busy}
            serverErrors={fields}
            submitLabel="Save role"
            onSubmit={(draft) => void save(draft)}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{role.managed ? "Who holds this role" : "People"}</CardTitle>
          <CardDescription>
            {inferred
              ? inferred.evidence
              : canAssign
                ? "Anyone you add here holds this role until you remove them."
                : "The people currently holding this role."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {role.managed ? (
            <p className="text-sm leading-6 text-muted-foreground">
              Membership is worked out for each person as their tokens are issued, so there is no
              list to edit here.
            </p>
          ) : (
            <RoleMembers
              key={role.id}
              roleId={role.id}
              roleName={role.name}
              canWrite={canAssign}
              page={members}
              after={after}
            />
          )}
        </CardContent>
      </Card>

      {!role.managed && canWrite && (
        <Card className="border-destructive/40">
          <CardHeader>
            <CardTitle>Delete this role</CardTitle>
            <CardDescription>
              {role.memberCount > 0
                ? `${role.memberCount} ${role.memberCount === 1 ? "person" : "people"} would lose its permissions.`
                : "Nobody holds it, so nothing changes for anyone."}{" "}
              Roles that inherit from it lose those permissions too. This cannot be undone.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ConfirmDelete
              label="Delete role"
              title={`Delete ${role.name}?`}
              description="Everyone holding it loses its permissions."
              busy={busy}
              onConfirm={remove}
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
