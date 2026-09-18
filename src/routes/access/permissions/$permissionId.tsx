import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { ArrowLeft, Trash2 } from "lucide-react";
import { type PermissionDraft, type RbacDraftErrors, permissionDraftFrom } from "@/auth/rbac";
import { useIdpAccessContext } from "@/components/idp-access";
import {
  RbacApiError,
  deletePermission,
  errorMessage,
  savePermission,
} from "@/components/rbac/api";
import { KeyChip } from "@/components/rbac/fields";
import { PermissionForm } from "@/components/rbac/permission-form";
import { canGrantPermission } from "@/components/rbac/delegation";
import { RequirePermission } from "@/components/rbac/require-permission";
import { useCatalog } from "@/components/rbac/use-catalog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const Route = createFileRoute("/access/permissions/$permissionId")({
  component: GuardedPermissionDetail,
});

function PermissionDetail() {
  const { permissionId } = Route.useParams();
  const navigate = useNavigate();
  const access = useIdpAccessContext();
  const { can } = access;
  const { catalog, loading, error: loadError, reload } = useCatalog();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [fields, setFields] = useState<RbacDraftErrors>();

  const permission = catalog.permissions.find((entry) => entry.id === permissionId);
  const canWrite =
    can("idp:permissions:write") &&
    !!permission &&
    (access.isMasterAdmin || !permission.managed) &&
    canGrantPermission(access, catalog, permission.key);
  const grantedBy = permission
    ? catalog.roles.filter((role) => role.permissions.includes(permission.key))
    : [];

  async function save(draft: PermissionDraft) {
    setBusy(true);
    setError("");
    setSaved(false);
    setFields(undefined);
    try {
      await savePermission(draft, permissionId);
      setSaved(true);
      reload();
    } catch (cause) {
      if (cause instanceof RbacApiError) setFields(cause.fields);
      setError(errorMessage(cause, "Unable to save the permission."));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!permission) return;
    if (
      !window.confirm(
        `Delete ${permission.name}? Applications checking for ${permission.key} will stop seeing it.`,
      )
    )
      return;
    setBusy(true);
    setError("");
    try {
      await deletePermission(permissionId);
      await navigate({ to: "/access/permissions" });
    } catch (cause) {
      setError(errorMessage(cause, "Unable to delete the permission."));
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <p className="py-10 text-center text-sm text-muted-foreground">Loading the permission…</p>
    );
  }
  if (loadError || !permission) {
    return (
      <div className="mx-auto max-w-lg space-y-4 py-10 text-center">
        <p role="alert">{loadError || "This permission no longer exists."}</p>
        <div className="flex flex-wrap justify-center gap-3">
          {loadError && <Button onClick={reload}>Try again</Button>}
          <Button variant="ghost" asChild>
            <Link to="/access/permissions">
              <ArrowLeft aria-hidden="true" />
              All permissions
            </Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <div>
        <Button variant="ghost" size="sm" className="-ml-2 text-muted-foreground" asChild>
          <Link to="/access/permissions">
            <ArrowLeft aria-hidden="true" />
            Permissions
          </Link>
        </Button>
        <h1 className="mt-3 text-3xl font-extrabold tracking-tight sm:text-4xl">
          {permission.name}
        </h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          <KeyChip>{permission.key}</KeyChip>
          {permission.managed && (
            <span className="ml-2">
              Built into the identity provider: it controls this service itself and cannot be
              deleted.
            </span>
          )}
        </p>
      </div>

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
          Saved. New sign-ins use this immediately; tokens already issued expire within minutes.
        </p>
      )}

      <Card>
        <CardContent className="pt-6">
          {can("idp:permissions:write") && !canWrite && (
            <p className="mb-6 text-sm text-muted-foreground">
              {permission.managed
                ? "Only Master Admin can change a built-in permission."
                : "You can change only permissions you already hold, including everything they grant. Ask Master Admin for access."}
            </p>
          )}
          <PermissionForm
            key={`${permission.id}-${permission.updatedAt ?? ""}`}
            mode="edit"
            initial={permissionDraftFrom(permission)}
            catalog={catalog}
            currentKey={permission.key}
            managed={permission.managed}
            readOnly={!canWrite}
            busy={busy}
            serverErrors={fields}
            submitLabel="Save permission"
            onSubmit={(draft) => void save(draft)}
          />
        </CardContent>
      </Card>

      {can("idp:roles:read") && (
        <Card>
          <CardHeader>
            <CardTitle>Roles that grant it</CardTitle>
            <CardDescription>
              Change these from each role's page. Roles inheriting from one of these grant it too.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {grantedBy.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No role grants this permission yet, so nobody holds it.{" "}
                {permission.managed &&
                  "Whoever the deployment configures as an administrator holds it anyway, through Master Admin."}
              </p>
            ) : (
              <ul className="divide-y rounded-xl border">
                {grantedBy.map((role) => (
                  <li key={role.id}>
                    <Link
                      to="/access/roles/$roleId"
                      params={{ roleId: role.id }}
                      className="flex items-center justify-between gap-3 px-4 py-3 text-sm transition-colors outline-none hover:bg-accent/50 focus-visible:bg-accent/50"
                    >
                      <span className="font-medium">{role.name}</span>
                      <KeyChip>{role.key}</KeyChip>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}

      {!permission.managed && canWrite && (
        <Card className="border-destructive/40">
          <CardHeader>
            <CardTitle>Delete this permission</CardTitle>
            <CardDescription>
              It is removed from every role that grants it and from every permission that grants it
              in turn. Applications checking for this key stop seeing it. This cannot be undone.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="destructive" disabled={busy} onClick={() => void remove()}>
              <Trash2 aria-hidden="true" />
              Delete permission
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function GuardedPermissionDetail() {
  return (
    <RequirePermission permission="idp:permissions:read">
      <PermissionDetail />
    </RequirePermission>
  );
}
