import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { ArrowLeft, Sparkles, Trash2 } from "lucide-react";
import {
  type RbacDraftErrors,
  type RoleDraft,
  effectiveRolePermissions,
  roleDraftFrom,
  staticRole,
} from "@/auth/rbac";
import { RbacApiError, deleteRole, errorMessage, saveRole } from "@/components/rbac/api";
import { KeyChip } from "@/components/rbac/fields";
import { RoleForm } from "@/components/rbac/role-form";
import { RoleMembers } from "@/components/rbac/role-members";
import { useCatalog } from "@/components/rbac/use-catalog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const Route = createFileRoute("/access/roles/$roleId")({ component: RoleDetail });

function RoleDetail() {
  const { roleId } = Route.useParams();
  const navigate = useNavigate();
  const { catalog, loading, error: loadError, reload } = useCatalog();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [fields, setFields] = useState<RbacDraftErrors>();

  const role = catalog.roles.find((entry) => entry.id === roleId);

  async function save(draft: RoleDraft) {
    setBusy(true);
    setError("");
    setSaved(false);
    setFields(undefined);
    try {
      await saveRole(draft, roleId);
      setSaved(true);
      reload();
    } catch (cause) {
      if (cause instanceof RbacApiError) setFields(cause.fields);
      setError(errorMessage(cause, "Unable to save the role."));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!role) return;
    if (!window.confirm(`Delete ${role.name}? Everyone holding it loses its permissions.`)) return;
    setBusy(true);
    setError("");
    try {
      await deleteRole(roleId);
      await navigate({ to: "/access/roles" });
    } catch (cause) {
      setError(errorMessage(cause, "Unable to delete the role."));
      setBusy(false);
    }
  }

  if (loading) {
    return <p className="py-10 text-center text-sm text-muted-foreground">Loading the role…</p>;
  }
  if (loadError || !role) {
    return (
      <div className="mx-auto max-w-lg space-y-4 py-10 text-center">
        <p role="alert">{loadError || "This role no longer exists."}</p>
        <div className="flex flex-wrap justify-center gap-3">
          {loadError && <Button onClick={reload}>Try again</Button>}
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
  const effective = effectiveRolePermissions(catalog, role.key);

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <div>
        <Button variant="ghost" size="sm" className="-ml-2 text-muted-foreground" asChild>
          <Link to="/access/roles">
            <ArrowLeft aria-hidden="true" />
            Roles
          </Link>
        </Button>
        <h1 className="mt-3 text-3xl font-extrabold tracking-tight sm:text-4xl">{role.name}</h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          <KeyChip>{role.key}</KeyChip>
          <span className="ml-2">
            {effective.length} {effective.length === 1 ? "permission" : "permissions"} in total,
            including inherited ones.
          </span>
        </p>
      </div>

      {inferred && (
        <div className="flex gap-3 rounded-xl border bg-muted/40 p-4 text-sm leading-6">
          <Sparkles className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
          <p>
            <strong className="font-medium">Granted automatically.</strong> {inferred.evidence}{" "}
            Nobody can be given or refused this role by hand; choose what it grants below.
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
          <RoleForm
            key={`${role.id}-${role.updatedAt ?? ""}`}
            mode="edit"
            initial={roleDraftFrom(role)}
            catalog={catalog}
            currentKey={role.key}
            managed={role.managed}
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
              : "Anyone you add here holds this role until you remove them."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {role.managed ? (
            <p className="text-sm leading-6 text-muted-foreground">
              Membership is worked out for each person as their tokens are issued, so there is no
              list to edit here.
            </p>
          ) : (
            <RoleMembers roleId={role.id} roleName={role.name} />
          )}
        </CardContent>
      </Card>

      {!role.managed && (
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
            <Button variant="destructive" disabled={busy} onClick={() => void remove()}>
              <Trash2 aria-hidden="true" />
              Delete role
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
