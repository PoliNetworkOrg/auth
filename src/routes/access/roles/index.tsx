import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronRight, KeyRound, Plus, ShieldCheck, Sparkles, Users } from "lucide-react";
import { type RoleSummary, effectiveRolePermissions, staticRole } from "@/auth/rbac";
import { KeyChip } from "@/components/rbac/fields";
import { useCatalog } from "@/components/rbac/use-catalog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const Route = createFileRoute("/access/roles/")({ component: RolesIndex });

function RoleRow({ role, effective }: { role: RoleSummary; effective: number }) {
  const inferred = role.managed ? staticRole(role.key) : undefined;
  return (
    <li>
      <Link
        to="/access/roles/$roleId"
        params={{ roleId: role.id }}
        className="flex items-center gap-4 px-5 py-4 transition-colors outline-none first:rounded-t-2xl last:rounded-b-2xl hover:bg-accent/50 focus-visible:bg-accent/50"
      >
        <div className="flex size-10 shrink-0 items-center justify-center rounded-xl border bg-background text-primary">
          {role.managed ? (
            <Sparkles className="size-4" aria-hidden="true" />
          ) : (
            <ShieldCheck className="size-4" aria-hidden="true" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h3 className="truncate text-sm font-semibold">{role.name}</h3>
            {role.managed && (
              <Badge className="bg-card text-muted-foreground">Granted automatically</Badge>
            )}
            {role.parents.length > 0 && (
              <Badge className="bg-card text-muted-foreground">
                Inherits {role.parents.join(", ")}
              </Badge>
            )}
          </div>
          <p className="mt-1 truncate text-xs text-muted-foreground">
            <KeyChip>{role.key}</KeyChip>{" "}
            <span className="ml-1">{inferred?.evidence ?? role.description ?? ""}</span>
          </p>
        </div>
        <div className="hidden shrink-0 items-center gap-4 text-xs text-muted-foreground sm:flex">
          <span className="flex items-center gap-1.5">
            <KeyRound className="size-3.5" aria-hidden="true" />
            {effective} {effective === 1 ? "permission" : "permissions"}
          </span>
          {!role.managed && (
            <span className="flex items-center gap-1.5">
              <Users className="size-3.5" aria-hidden="true" />
              {role.memberCount} {role.memberCount === 1 ? "person" : "people"}
            </span>
          )}
        </div>
        <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      </Link>
    </li>
  );
}

function RolesIndex() {
  const { catalog, loading, error, reload } = useCatalog();
  const managed = catalog.roles.filter((role) => role.managed);
  const custom = catalog.roles.filter((role) => !role.managed);

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">Roles</h1>
          <p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground">
            A role is a named bundle of permissions. Applications read them from the{" "}
            <code className="font-mono text-xs">polinetwork:identity</code> scope.
          </p>
        </div>
        <Button asChild>
          <Link to="/access/roles/new">
            <Plus aria-hidden="true" />
            New role
          </Link>
        </Button>
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
        <ul aria-busy="true" aria-label="Loading roles" className="space-y-3">
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
                These roles always exist and nobody hands them out: they follow the evidence the
                identity provider already collects. You can still choose what they grant and where
                they sit in the hierarchy.
              </CardDescription>
            </CardHeader>
            <CardContent className="px-0 pb-0">
              <ul className="divide-y border-t" aria-label="Built-in roles">
                {managed.map((role) => (
                  <RoleRow
                    key={role.id}
                    role={role}
                    effective={effectiveRolePermissions(catalog, role.key).length}
                  />
                ))}
              </ul>
            </CardContent>
          </Card>

          <div>
            <h2 className="mb-3 text-sm font-semibold text-muted-foreground">Roles you created</h2>
            {custom.length === 0 ? (
              <Card>
                <CardContent className="flex flex-col items-center gap-4 px-6 py-14 text-center">
                  <div className="flex size-14 items-center justify-center rounded-2xl border bg-background text-primary">
                    <ShieldCheck className="size-6" aria-hidden="true" />
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold">No roles of your own yet</h3>
                    <p className="mt-2 max-w-sm text-sm leading-6 text-muted-foreground">
                      Create a role to bundle permissions and give them to specific people.
                    </p>
                  </div>
                  <Button asChild>
                    <Link to="/access/roles/new">
                      <Plus aria-hidden="true" />
                      New role
                    </Link>
                  </Button>
                </CardContent>
              </Card>
            ) : (
              <Card>
                <ul className="divide-y" aria-label="Your roles">
                  {custom.map((role) => (
                    <RoleRow
                      key={role.id}
                      role={role}
                      effective={effectiveRolePermissions(catalog, role.key).length}
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
