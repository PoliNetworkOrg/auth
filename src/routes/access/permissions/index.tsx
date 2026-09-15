import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronRight, KeyRound, Plus, ShieldCheck } from "lucide-react";
import { expandPermissionKeys } from "@/auth/rbac";
import { KeyChip } from "@/components/rbac/fields";
import { useCatalog } from "@/components/rbac/use-catalog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export const Route = createFileRoute("/access/permissions/")({ component: PermissionsIndex });

function PermissionsIndex() {
  const { catalog, loading, error, reload } = useCatalog();

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
        <Button asChild>
          <Link to="/access/permissions/new">
            <Plus aria-hidden="true" />
            New permission
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
        <ul aria-busy="true" aria-label="Loading permissions" className="space-y-3">
          {[0, 1, 2].map((index) => (
            <li key={index} className="h-20 animate-pulse rounded-2xl border bg-card" />
          ))}
        </ul>
      ) : catalog.permissions.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-4 px-6 py-14 text-center">
            <div className="flex size-14 items-center justify-center rounded-2xl border bg-background text-primary">
              <KeyRound className="size-6" aria-hidden="true" />
            </div>
            <div>
              <h2 className="text-lg font-semibold">No permissions yet</h2>
              <p className="mt-2 max-w-sm text-sm leading-6 text-muted-foreground">
                Name the first thing an application should be able to check for, such as reading the
                member list.
              </p>
            </div>
            <Button asChild>
              <Link to="/access/permissions/new">
                <Plus aria-hidden="true" />
                New permission
              </Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <ul className="divide-y" aria-label="Permissions">
            {catalog.permissions.map((permission) => {
              const implied = expandPermissionKeys(catalog, permission.implies).filter(
                (key) => key !== permission.key,
              );
              return (
                <li key={permission.id}>
                  <Link
                    to="/access/permissions/$permissionId"
                    params={{ permissionId: permission.id }}
                    className="flex items-center gap-4 px-5 py-4 transition-colors outline-none first:rounded-t-2xl last:rounded-b-2xl hover:bg-accent/50 focus-visible:bg-accent/50"
                  >
                    <div className="flex size-10 shrink-0 items-center justify-center rounded-xl border bg-background text-primary">
                      <KeyRound className="size-4" aria-hidden="true" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <h2 className="truncate text-sm font-semibold">{permission.name}</h2>
                        {implied.length > 0 && (
                          <Badge className="bg-card text-muted-foreground">
                            Also grants {implied.length}
                          </Badge>
                        )}
                      </div>
                      <p className="mt-1 truncate text-xs text-muted-foreground">
                        <KeyChip>{permission.key}</KeyChip>
                        {permission.description && (
                          <span className="ml-2">{permission.description}</span>
                        )}
                      </p>
                    </div>
                    <div className="hidden shrink-0 items-center gap-1.5 text-xs text-muted-foreground sm:flex">
                      <ShieldCheck className="size-3.5" aria-hidden="true" />
                      {permission.roleCount} {permission.roleCount === 1 ? "role" : "roles"}
                    </div>
                    <ChevronRight
                      className="size-4 shrink-0 text-muted-foreground"
                      aria-hidden="true"
                    />
                  </Link>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </div>
  );
}
