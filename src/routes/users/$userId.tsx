import { createFileRoute, Link, useNavigate, useRouter } from "@tanstack/react-router";
import { ArrowLeft, Clock, KeyRound, Mail, RefreshCw } from "lucide-react";
import { emptyCatalog } from "@/auth/rbac";
import { getCatalog } from "@/auth/rbac.functions";
import { getUser } from "@/auth/users.functions";
import type { UserDetail, UserTrait } from "@/auth/users";
import { accessOf, useAccess, useViewer } from "@/components/access";
import { CopyButton } from "@/components/copy-button";
import { KeyChip } from "@/components/rbac/fields";
import { DeleteUser } from "@/components/users/delete-user";
import { StatusBadges, TRAIT_ICONS } from "@/components/users/traits";
import { UserRoles } from "@/components/users/user-roles";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { UserAvatar } from "@/components/user-avatar";

export const Route = createFileRoute("/users/$userId")({
  loader: async ({ context, params }) => {
    const access = accessOf(context.viewer);
    // Role and permission names come from the catalog, for whoever may read it.
    const [person, catalog] = await Promise.all([
      getUser({ data: { userId: params.userId } }),
      access.can("idp:roles:read") || access.can("idp:permissions:read")
        ? getCatalog()
        : emptyCatalog,
    ]);
    return { person, catalog };
  },
  component: UserDetailPage,
});

function formatDate(value: string | null) {
  return value ? new Date(value).toLocaleDateString(undefined, { dateStyle: "medium" }) : "Unknown";
}

const ACCOUNT_KINDS: { providerId: string; trait: UserTrait; name: string }[] = [
  { providerId: "google", trait: "google", name: "Google" },
  { providerId: "pn-entra", trait: "polinetwork", name: "PoliNetwork APS" },
  { providerId: "telegram", trait: "telegram", name: "Telegram" },
  { providerId: "polimi-email", trait: "student", name: "Polimi email" },
];

function LinkedAccounts({ person }: { person: UserDetail }) {
  const PasskeyIcon = TRAIT_ICONS.passkey;
  return (
    <ul className="divide-y">
      {ACCOUNT_KINDS.map((kind) => {
        const Icon = TRAIT_ICONS[kind.trait];
        const linked = person.accounts.filter((entry) => entry.providerId === kind.providerId);
        return (
          <li key={kind.providerId} className="flex items-start gap-3 py-3 first:pt-0">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border bg-background text-primary">
              <Icon className="size-4" aria-hidden="true" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">{kind.name}</p>
              {linked.length === 0 ? (
                <p className="text-xs text-muted-foreground">Not linked</p>
              ) : (
                linked.map((entry) => (
                  <div key={entry.id} className="mt-0.5 space-y-0.5 text-xs text-muted-foreground">
                    {entry.identifier && (
                      <p className="flex items-center gap-1 font-mono text-foreground">
                        <span className="truncate">{entry.identifier}</span>
                        <CopyButton
                          value={entry.identifier}
                          label={`Copy ${kind.name} identifier`}
                          size="icon-xs"
                        />
                      </p>
                    )}
                    <p>
                      Linked {formatDate(entry.linkedAt)}
                      {entry.validUntil &&
                        (new Date(entry.validUntil) > new Date()
                          ? ` · verified until ${formatDate(entry.validUntil)}`
                          : ` · verification expired ${formatDate(entry.validUntil)}`)}
                    </p>
                  </div>
                ))
              )}
            </div>
          </li>
        );
      })}
      <li className="flex items-start gap-3 py-3 last:pb-0">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border bg-background text-primary">
          <PasskeyIcon className="size-4" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">Passkeys</p>
          <p className="text-xs text-muted-foreground">
            {person.passkeys === 0 ? "None registered" : `${person.passkeys} registered`}
          </p>
        </div>
      </li>
    </ul>
  );
}

function UserDetailPage() {
  const { person, catalog } = Route.useLoaderData();
  const { can } = useAccess();
  const viewer = useViewer();
  const router = useRouter();
  const navigate = useNavigate();

  const held = (trait: UserTrait) => person.states.includes(trait);
  const permissionName = (key: string) =>
    catalog.permissions.find((entry) => entry.key === key)?.name;

  return (
    <div className="space-y-8">
      <div>
        <Button variant="ghost" size="sm" className="-ml-2 text-muted-foreground" asChild>
          <Link to="/users">
            <ArrowLeft aria-hidden="true" />
            Users
          </Link>
        </Button>
        <div className="mt-4 flex flex-wrap items-center gap-5">
          <div className="size-16 shrink-0 overflow-hidden rounded-full border bg-muted text-lg font-semibold text-muted-foreground">
            <UserAvatar name={person.name} image={person.image} />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-3xl font-extrabold tracking-tight sm:text-4xl">
              {person.name}
            </h1>
            <p className="mt-2 flex items-center gap-1.5 text-sm text-muted-foreground">
              <Mail className="size-4" aria-hidden="true" />
              {person.email ?? "No email on file"}
            </p>
          </div>
        </div>
      </div>

      <div className="grid items-start gap-8 lg:grid-cols-[1fr_340px]">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Status</CardTitle>
              <CardDescription>
                Checked just now, the same way their next token would be: group membership in
                PoliNetwork Entra and an unexpired Polimi verification.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {person.states.length ? (
                <StatusBadges held={held} />
              ) : (
                <p className="text-sm text-muted-foreground">
                  Not a verified Socio, Direttivo member, or student.
                </p>
              )}
            </CardContent>
          </Card>

          {person.assignedRoles !== null && person.roles !== null && (
            <Card>
              <CardHeader>
                <CardTitle>Roles</CardTitle>
                <CardDescription>
                  {can("idp:roles:assign")
                    ? "Give or remove the roles you manage. Built-in roles follow the evidence above and cannot be changed here."
                    : "The roles given to this person by hand."}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <UserRoles
                  userId={person.id}
                  userName={person.name}
                  assigned={person.assignedRoles}
                  held={person.roles}
                  catalog={catalog}
                />
              </CardContent>
            </Card>
          )}

          {person.permissions !== null && (
            <Card>
              <CardHeader>
                <CardTitle>Permissions</CardTitle>
                <CardDescription>
                  Everything their roles grant, including inherited and implied permissions.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {person.permissions.length ? (
                  <ul className="flex flex-wrap gap-2" aria-label="Permissions">
                    {person.permissions.map((key) => (
                      <li key={key} title={permissionName(key)}>
                        <KeyChip>{key}</KeyChip>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted-foreground">No permissions.</p>
                )}
              </CardContent>
            </Card>
          )}

          {can("idp:users:delete") && (
            <DeleteUser
              userId={person.id}
              userName={person.name}
              isSelf={viewer?.user.id === person.id}
              onDeleted={() => {
                // The list may be cached with this person still in it.
                router.clearCache({ filter: (match) => match.routeId === "/users/" });
                return navigate({ to: "/users" });
              }}
            />
          )}
        </div>

        <aside className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Linked accounts</CardTitle>
            </CardHeader>
            <CardContent>
              <LinkedAccounts person={person} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Details</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="space-y-3 text-sm">
                <div className="flex items-center gap-3">
                  <KeyRound className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <dt className="text-muted-foreground">User ID</dt>
                  <dd className="ml-auto flex min-w-0 items-center gap-1">
                    <span className="truncate font-mono text-xs" title={person.id}>
                      {person.id}
                    </span>
                    <CopyButton value={person.id} label="Copy user ID" size="icon-xs" />
                  </dd>
                </div>
                <div className="flex items-center gap-3">
                  <Clock className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <dt className="text-muted-foreground">Joined</dt>
                  <dd className="ml-auto font-medium">{formatDate(person.createdAt)}</dd>
                </div>
                <div className="flex items-center gap-3">
                  <RefreshCw className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <dt className="text-muted-foreground">Updated</dt>
                  <dd className="ml-auto font-medium">{formatDate(person.updatedAt)}</dd>
                </div>
              </dl>
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  );
}
