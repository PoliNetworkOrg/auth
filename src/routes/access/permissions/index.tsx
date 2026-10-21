import { matchesSearch } from "@/lib/search";
import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronRight, KeyRound, Plus, ShieldCheck, Sparkles } from "lucide-react";
import { type PermissionSummary, expandPermissionKeys } from "@/auth/rbac";
import { getCatalog } from "@/auth/rbac.functions";
import { requireAccess, useAccess } from "@/components/access";
import { CatalogSearch, CatalogSearchEmpty } from "@/components/rbac/catalog-search";
import { KeyChip } from "@/components/rbac/fields";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const Route = createFileRoute("/access/permissions/")({
  beforeLoad: ({ context }) => requireAccess(context.viewer, "idp:permissions:read"),
  loader: () => getCatalog(),
  component: PermissionsIndex,
});

function applicationKey(permission: PermissionSummary) {
  return permission.key.split(":")[0];
}

function applicationLabel(key: string) {
  if (key === "idp") return "PoliNetwork Auth";
  if (key === "tg") return "Telegram";
  if (key === "wa") return "WhatsApp";
  if (key === "web") return "Website";
  if (key === "azure") return "Microsoft Entra";
  return key.charAt(0).toUpperCase() + key.slice(1);
}

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
        className="flex items-center gap-4 px-5 py-4 transition-colors outline-none hover:bg-accent/50 focus-visible:bg-accent/50"
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
            {permission.managed && (
              <Badge className="bg-card text-muted-foreground">Built-in</Badge>
            )}
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
  const { can } = useAccess();
  const catalog = Route.useLoaderData();
  const [query, setQuery] = useState("");
  const [application, setApplication] = useState<string | null>(null);
  const applications = [...new Set(catalog.permissions.map(applicationKey))].sort();
  const search = query.trim().toLowerCase();
  const filtered = catalog.permissions.filter(
    (permission) =>
      (application === null || applicationKey(permission) === application) &&
      matchesSearch(search, [
        permission.name,
        permission.key,
        permission.description,
        applicationLabel(applicationKey(permission)),
        ...expandPermissionKeys(catalog, permission.implies).flatMap((key) => {
          const implied = catalog.permissions.find((entry) => entry.key === key);
          return [key, implied?.name, implied?.description];
        }),
      ]),
  );
  const impliedBy = (permission: PermissionSummary) =>
    expandPermissionKeys(catalog, permission.implies).filter((key) => key !== permission.key);
  const groups = applications
    .map((key) => ({
      key,
      permissions: filtered
        .filter((permission) => applicationKey(permission) === key)
        .sort((a, b) => a.key.localeCompare(b.key)),
    }))
    .filter((group) => group.permissions.length > 0);

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="max-w-xl text-sm leading-6 text-muted-foreground">
            The things an application can check for. They reach applications as the{" "}
            <code className="font-mono text-xs">polinetwork_permissions</code> claim; each
            application still enforces its own.
          </p>
        </div>
      </div>

      <CatalogSearch
        kind="permissions"
        query={query}
        onQueryChange={setQuery}
        count={filtered.length}
        total={catalog.permissions.length}
      >
        {can("idp:permissions:write") && (
          <Button asChild>
            <Link to="/access/permissions/new">
              <Plus aria-hidden="true" />
              New permission
            </Link>
          </Button>
        )}
      </CatalogSearch>

      {applications.length > 0 && (
        <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by application">
          <Button
            variant={application === null ? "default" : "outline"}
            size="sm"
            aria-pressed={application === null}
            onClick={() => setApplication(null)}
          >
            All applications
          </Button>
          {applications.map((key) => (
            <Button
              key={key}
              variant={application === key ? "default" : "outline"}
              size="sm"
              aria-pressed={application === key}
              onClick={() => setApplication(key)}
            >
              {applicationLabel(key)}
              <span className="tabular-nums opacity-70">
                {
                  catalog.permissions.filter((permission) => applicationKey(permission) === key)
                    .length
                }
              </span>
            </Button>
          ))}
        </div>
      )}

      {filtered.length === 0 &&
        (search ? (
          <CatalogSearchEmpty kind="permissions" />
        ) : (
          <Card>
            <CardContent className="flex flex-col items-center gap-4 px-6 py-14 text-center">
              <KeyRound className="size-6 text-primary" aria-hidden="true" />
              <div>
                <h2 className="text-lg font-semibold">No permissions yet</h2>
                <p className="mt-2 max-w-sm text-sm leading-6 text-muted-foreground">
                  Create a permission for something one of your applications should be able to
                  check.
                </p>
              </div>
            </CardContent>
          </Card>
        ))}

      <div className="space-y-6">
        {groups.map(({ key, permissions }) => (
          <Card key={key}>
            <CardHeader>
              <div className="flex flex-wrap items-center gap-3">
                <CardTitle>{applicationLabel(key)}</CardTitle>
                <KeyChip>{key}:*</KeyChip>
                <Badge className="bg-muted text-muted-foreground">
                  {permissions.length} {permissions.length === 1 ? "permission" : "permissions"}
                </Badge>
              </div>
              {key === "idp" && (
                <CardDescription>
                  Permissions for administering PoliNetwork Auth. Built-in permissions always exist
                  and cannot be deleted.
                </CardDescription>
              )}
            </CardHeader>
            <CardContent className="px-0 pb-0">
              <ul className="divide-y border-t" aria-label={`${applicationLabel(key)} permissions`}>
                {permissions.map((permission) => (
                  <PermissionRow
                    key={permission.id}
                    permission={permission}
                    implied={impliedBy(permission)}
                  />
                ))}
              </ul>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
