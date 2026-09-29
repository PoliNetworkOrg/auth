import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronRight, KeyRound, Plus, ShieldCheck, Sparkles } from "lucide-react";
import { type PermissionSummary, expandPermissionKeys } from "@/auth/rbac";
import { useIdpAccessContext } from "@/components/idp-access";
import { KeyChip } from "@/components/rbac/fields";
import { RequirePermission } from "@/components/rbac/require-permission";
import { useCatalog } from "@/components/rbac/use-catalog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const Route = createFileRoute("/access/permissions/")({
  component: GuardedPermissionsIndex,
});

function PermissionRow({
  permission,
  implied,
}: {
  permission: PermissionSummary;
  implied: string[];
}) {
  return (
    <li>
      <Link
        to="/access/permissions/$permissionId"
        params={{ permissionId: permission.id }}
        className="flex items-center gap-4 px-5 py-4 transition-colors outline-none first:rounded-t-2xl last:rounded-b-2xl hover:bg-accent/50 focus-visible:bg-accent/50"
      >
        <div className="flex size-10 shrink-0 items-center justify-center rounded-xl border bg-background text-primary">
          {permission.managed ? (
            <Sparkles className="size-4" aria-hidden="true" />
          ) : (
            <KeyRound className="size-4" aria-hidden="true" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h3 className="truncate text-sm font-semibold">{permission.name}</h3>
            {implied.length > 0 && (
              <Badge className="bg-card text-muted-foreground">Also grants {implied.length}</Badge>
            )}
          </div>
          <p className="mt-1 truncate text-xs text-muted-foreground">
            <KeyChip>{permission.key}</KeyChip>
            {permission.description && <span className="ml-2">{permission.description}</span>}
          </p>
        </div>
        <div className="hidden shrink-0 items-center gap-1.5 text-xs text-muted-foreground sm:flex">
          <ShieldCheck className="size-3.5" aria-hidden="true" />
          {permission.roleCount} {permission.roleCount === 1 ? "role" : "roles"}
        </div>
        <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      </Link>
    </li>
  );
}

function PermissionsIndex() {
  const { can } = useIdpAccessContext();
  const { catalog, loading, error, reload } = useCatalog();
  const impliedBy = (permission: PermissionSummary) =>
    expandPermissionKeys(catalog, permission.implies).filter((key) => key !== permission.key);
  const managed = catalog.permissions.filter((permission) => permission.managed);
  const custom = catalog.permissions.filter((permission) => !permission.managed);

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">Permissions</h1>
          <p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground">
            The things an application can check for. They reach applications as the{" "}
            <code className="font-mono text-xs">polinetwork_permissions</code> claim; each
            application still enforces its own.
          </p>
        </div>
        {can("idp:permissions:write") && (
          <Button asChild>
            <Link to="/access/permissions/new">
              <Plus aria-hidden="true" />
              New permission
            </Link>
          </Button>
        )}
      </div>

      {error && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-destructive bg-destructive/5 p-4 text-sm"
        >
          <span>{error}</span>
          <Button variant="outline" size="sm" onClick={reload}>
            Try again
          </Button>
        </div>
      )}

      {loading && !error ? (
        <ul aria-busy="true" aria-label="Loading permissions" className="space-y-3">
          {[0, 1, 2].map((index) => (
            <li key={index} className="h-20 animate-pulse rounded-2xl border bg-card" />
          ))}
        </ul>
      ) : (
        <div className="space-y-8">
          <Card>
            <CardHeader>
              <CardTitle>Built into the identity provider</CardTitle>
              <CardDescription>
                These permissions control this service itself. They always exist and cannot be
                deleted, because the code checks for these exact keys. Give them to a role to let
                someone administer part of PoliNetwork Identity.
              </CardDescription>
            </CardHeader>
            <CardContent className="px-0 pb-0">
              <ul className="divide-y border-t" aria-label="Built-in permissions">
                {managed.map((permission) => (
                  <PermissionRow
                    key={permission.id}
                    permission={permission}
                    implied={impliedBy(permission)}
                  />
                ))}
              </ul>
            </CardContent>
          </Card>

          <div>
            <h2 className="mb-3 text-sm font-semibold text-muted-foreground">
              Permissions you created
            </h2>
            {custom.length === 0 ? (
              <Card>
                <CardContent className="flex flex-col items-center gap-4 px-6 py-14 text-center">
                  <div className="flex size-14 items-center justify-center rounded-2xl border bg-background text-primary">
                    <KeyRound className="size-6" aria-hidden="true" />
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold">No permissions of your own yet</h3>
                    <p className="mt-2 max-w-sm text-sm leading-6 text-muted-foreground">
                      Name the first thing one of your applications should be able to check for,
                      such as reading the member list.
                    </p>
                  </div>
                  {can("idp:permissions:write") && (
                    <Button asChild>
                      <Link to="/access/permissions/new">
                        <Plus aria-hidden="true" />
                        New permission
                      </Link>
                    </Button>
                  )}
                </CardContent>
              </Card>
            ) : (
              <Card>
                <ul className="divide-y" aria-label="Your permissions">
                  {custom.map((permission) => (
                    <PermissionRow
                      key={permission.id}
                      permission={permission}
                      implied={impliedBy(permission)}
                    />
                  ))}
                </ul>
              </Card>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function GuardedPermissionsIndex() {
  return (
    <RequirePermission permission="idp:permissions:read">
      <PermissionsIndex />
    </RequirePermission>
  );
}
