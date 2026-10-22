import { matchesSearch } from "@/lib/search";
import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ShieldCheck } from "lucide-react";
import {
  type RoleSummary,
  effectiveRolePermissions,
  staticRole,
  staticRoleOrder,
} from "@/auth/rbac";
import { getCatalog } from "@/auth/rbac.functions";
import { requireAccess, useAccess } from "@/components/access";
import { CatalogSearchEmpty, SearchField } from "@/components/rbac/catalog-search";
import { KeyChip } from "@/components/rbac/fields";
import {
  HelpIcon,
  MasterAdminIcon,
  MembersIcon,
  NewIcon,
  PermissionsIcon,
} from "@/components/rbac/icons";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export const Route = createFileRoute("/access/roles/")({
  beforeLoad: ({ context }) => requireAccess(context.viewer, "idp:roles:read"),
  loader: () => getCatalog(),
  component: RolesIndex,
});

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

function BuiltInRoleIcon({ roleKey }: { roleKey: string }) {
  if (roleKey === "master-admin") return <MasterAdminIcon />;
  if (roleKey === "student")
    // The seal is drawn in white, so the light theme gets a disc to hold it.
    return (
      <span className="flex size-[41px] items-center justify-center rounded-full bg-[#1f3a68] dark:bg-transparent">
        <img
          src="/brands/polimi.svg"
          alt=""
          width={41}
          height={41}
          draggable={false}
          className="scale-90 dark:scale-100"
        />
      </span>
    );
  // The mark is drawn in white too, so the light theme shows the full-colour logo instead.
  return (
    <>
      <img
        src="/polinetwork-logo.svg"
        alt=""
        width={41}
        height={41}
        draggable={false}
        className="dark:hidden"
      />
      <img
        src="/brands/polinetwork-mono.svg"
        alt=""
        width={41}
        height={41}
        draggable={false}
        className="hidden dark:block"
      />
    </>
  );
}

/** `effective` is null for a role that holds every permission there is. */
function BuiltInRoleCard({ role, effective }: { role: RoleSummary; effective: number | null }) {
  return (
    <li>
      <Card className="h-47 transition-colors has-[a:hover]:bg-accent/50 has-[a:focus-visible]:bg-accent/50">
        <Link
          to="/access/roles/$roleId"
          params={{ roleId: role.id }}
          title={staticRole(role.key)?.evidence}
          className="flex size-full flex-col items-center px-3 pt-7 pb-3.5 text-center outline-none"
        >
          <span className="flex size-[42px] items-center justify-center">
            <BuiltInRoleIcon roleKey={role.key} />
          </span>
          <h3 className="mt-3 max-w-full truncate text-base">{role.name}</h3>
          <span className="mt-1.5 max-w-full truncate">
            <KeyChip>{role.key}</KeyChip>
          </span>
          <span className="mt-auto flex items-center gap-1.5 text-xs text-muted-foreground">
            <PermissionsIcon />
            {effective === null ? (
              <span className="font-mono">ALL</span>
            ) : (
              plural(effective, "permission", "permissions")
            )}
          </span>
        </Link>
      </Card>
    </li>
  );
}

function CreatedRoleRow({ role, effective }: { role: RoleSummary; effective: number }) {
  return (
    <li>
      <Card className="transition-colors has-[a:hover]:bg-accent/50 has-[a:focus-visible]:bg-accent/50">
        <Link
          to="/access/roles/$roleId"
          params={{ roleId: role.id }}
          className="flex min-h-15 items-center gap-4 px-7.5 py-3 outline-none"
        >
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <h3 className="truncate text-base">{role.name}</h3>
            <KeyChip>{role.key}</KeyChip>
          </div>
          <div className="flex shrink-0 items-center gap-8 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <MembersIcon />
              {role.memberCount}
              <span className="sr-only">{role.memberCount === 1 ? "person" : "people"}</span>
            </span>
            <span className="flex items-center gap-1.5">
              <PermissionsIcon />
              {plural(effective, "permission", "permissions")}
            </span>
          </div>
        </Link>
      </Card>
    </li>
  );
}

function RolesIndex() {
  const { can } = useAccess();
  const catalog = Route.useLoaderData();
  const [query, setQuery] = useState("");
  const search = query.trim().toLowerCase();
  const managed = catalog.roles
    .filter((role) => role.managed)
    .sort((a, b) => staticRoleOrder(a.key) - staticRoleOrder(b.key));
  const created = catalog.roles.filter((role) => !role.managed);
  const filtered = created.filter((role) =>
    matchesSearch(search, [
      role.name,
      role.key,
      role.description,
      ...role.parents.flatMap((key) => {
        const parent = catalog.roles.find((entry) => entry.key === key);
        return [key, parent?.name, parent?.description];
      }),
      ...effectiveRolePermissions(catalog, role.key).flatMap((key) => {
        const permission = catalog.permissions.find((entry) => entry.key === key);
        return [key, permission?.name, permission?.description];
      }),
    ]),
  );
  const countFor = (role: RoleSummary) => effectiveRolePermissions(catalog, role.key).length;

  return (
    <div className="space-y-10">
      <section aria-labelledby="built-in-roles" className="space-y-5">
        <div className="flex items-center gap-2.5">
          <h2 id="built-in-roles" className="text-base text-muted-foreground">
            Built-in
          </h2>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label="About built-in roles"
                className="rounded-full text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
              >
                <HelpIcon />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right" className="max-w-xs">
              These roles always exist and nobody hands them out: they follow the evidence the
              identity provider already collects, and Master Admin follows the administrator
              allowlist configured for this deployment. You can still choose what they grant and
              where they sit in the hierarchy.
            </TooltipContent>
          </Tooltip>
        </div>
        <ul
          className="grid grid-cols-2 gap-6 sm:grid-cols-[repeat(auto-fill,10.375rem)]"
          aria-label="Built-in roles"
        >
          {managed.map((role) => (
            <BuiltInRoleCard
              key={role.id}
              role={role}
              effective={staticRole(role.key)?.grantsAllPermissions ? null : countFor(role)}
            />
          ))}
        </ul>
      </section>

      <section aria-labelledby="created-roles" className="space-y-5">
        <h2 id="created-roles" className="text-base text-muted-foreground">
          Created
        </h2>
        <div className="flex flex-wrap items-center gap-x-7.5 gap-y-3">
          <SearchField
            kind="roles"
            query={query}
            onQueryChange={setQuery}
            className="flex-1 basis-64"
            inputClassName="h-10 bg-card dark:bg-card"
          />
          <p role="status" className="sr-only">
            {search
              ? `${filtered.length} of ${plural(created.length, "role", "roles")}`
              : plural(created.length, "role", "roles")}
          </p>
          {can("idp:roles:write") && (
            <Button asChild size="lg">
              <Link to="/access/roles/new">
                <NewIcon />
                New Role
              </Link>
            </Button>
          )}
        </div>

        {created.length === 0 ? (
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
            </CardContent>
          </Card>
        ) : filtered.length === 0 ? (
          <CatalogSearchEmpty kind="roles" />
        ) : (
          <ul className="space-y-5" aria-label="Your roles">
            {filtered.map((role) => (
              <CreatedRoleRow key={role.id} role={role} effective={countFor(role)} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
