import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Info, Search, Send, Users, X } from "lucide-react";
import { cn } from "cn";
import {
  type UserListPage,
  type UserSearch,
  type UserTrait,
  USER_TRAITS,
  hasUserFilters,
  userSearchParams,
  userSearchSchema,
} from "@/auth/users";
import { useIdpAccessContext } from "@/components/idp-access";
import { errorMessage } from "@/components/rbac/api";
import { useCatalog } from "@/components/rbac/use-catalog";
import { fetchUsers } from "@/components/users/api";
import { SignInIcons, StatusBadges, TRAIT_ICONS } from "@/components/users/traits";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { UserAvatar } from "@/components/user-avatar";

export const Route = createFileRoute("/users/")({
  validateSearch: userSearchSchema,
  component: UsersIndex,
});

const ANY_ROLE = "any";

function formatDate(value: string) {
  return new Date(value).toLocaleDateString(undefined, { dateStyle: "medium" });
}

/** Any, only people who have it, or only people who do not. */
function TraitFilter({
  trait,
  value,
  onChange,
}: {
  trait: (typeof USER_TRAITS)[number];
  value: "yes" | "no" | undefined;
  onChange: (value: "yes" | "no" | undefined) => void;
}) {
  const Icon = TRAIT_ICONS[trait.key];
  const options = [
    { value: undefined, label: "Any" },
    { value: "yes", label: "Yes" },
    { value: "no", label: "No" },
  ] as const;
  return (
    <div className="space-y-1.5">
      <p id={`trait-${trait.key}`} className="flex items-center gap-1.5 text-xs font-medium">
        <Icon className="size-3.5 text-muted-foreground" aria-hidden="true" />
        {trait.label}
      </p>
      <div
        role="radiogroup"
        aria-labelledby={`trait-${trait.key}`}
        className="inline-flex rounded-lg border bg-background p-0.5"
      >
        {options.map((option) => {
          const checked = value === option.value;
          return (
            <button
              key={option.label}
              type="button"
              role="radio"
              aria-checked={checked}
              onClick={() => onChange(option.value)}
              className={cn(
                "rounded-md px-2.5 py-1 text-xs font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring",
                checked
                  ? option.value === "no"
                    ? "bg-destructive/10 text-destructive"
                    : option.value === "yes"
                      ? "bg-primary/10 text-primary"
                      : "bg-secondary text-secondary-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function MembershipNotice({ page }: { page: UserListPage }) {
  const recorded = (["socio", "direttivo"] as const).filter(
    (key) => page.membership[key] === "recorded",
  );
  if (!recorded.length) return null;
  const names = recorded.map((key) => (key === "socio" ? "Socio" : "Direttivo")).join(" and ");
  return (
    <div role="status" className="flex gap-3 rounded-xl border bg-muted/40 p-4 text-sm leading-6">
      <Info className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
      <p>
        Microsoft Entra could not be reached, so {names}{" "}
        {recorded.length === 1 ? "status shows" : "statuses show"} what each person's last
        PoliNetwork sign-in recorded. Open someone to check it live.
      </p>
    </div>
  );
}

function UsersIndex() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const { can } = useIdpAccessContext();
  const canReadRoles = can("idp:roles:read");
  const { catalog } = useCatalog(canReadRoles);
  const [query, setQuery] = useState(search.q ?? "");
  const [data, setData] = useState<UserListPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const key = userSearchParams(search).toString();

  const update = (changes: Partial<UserSearch>) =>
    void navigate({
      // Any change to what is shown starts again from the first page.
      search: (previous) => ({ ...previous, page: undefined, ...changes }),
      replace: true,
    });

  // Follow the URL when it changes from outside the box, such as the back button.
  useEffect(() => setQuery(search.q ?? ""), [search.q]);

  useEffect(() => {
    const term = query.trim() || undefined;
    if (term === search.q) return;
    const timer = setTimeout(() => update({ q: term }), 300);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    fetchUsers(search, controller.signal)
      .then((page) => {
        setData(page);
        setLoading(false);
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setError(errorMessage(cause, "Unable to load users."));
        setLoading(false);
      });
    return () => controller.abort();
  }, [key, revision]);

  const customRoles = catalog.roles.filter((role) => !role.managed);
  const roleName = (key: string) => catalog.roles.find((role) => role.key === key)?.name ?? key;
  const filtered = hasUserFilters(search);
  const first = data ? (data.page - 1) * data.pageSize + 1 : 0;
  const last = data ? first + data.users.length - 1 : 0;
  const hasNext = data ? data.page * data.pageSize < data.total : false;
  const held = (traits: Record<UserTrait, boolean>) => (trait: UserTrait) => traits[trait];

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">Users</h1>
          <p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground">
            Everyone registered with PoliNetwork Identity, with the accounts they have linked and
            what those accounts prove.
          </p>
        </div>
        {data && (
          <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <Users className="size-4" aria-hidden="true" />
            {data.total} {data.total === 1 ? "person" : "people"}
            {filtered ? " match" : ""}
          </p>
        )}
      </div>

      <Card className="p-5">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-60 flex-1">
            <Search
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Name, email, Polimi address, Telegram ID, or user ID"
              aria-label="Search users"
              className="pl-9"
            />
          </div>
          {canReadRoles && (
            <Select
              value={search.role ?? ANY_ROLE}
              onValueChange={(value) => update({ role: value === ANY_ROLE ? undefined : value })}
            >
              <SelectTrigger aria-label="Filter by role" className="min-w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY_ROLE}>Any role</SelectItem>
                {customRoles.map((role) => (
                  <SelectItem key={role.id} value={role.key}>
                    {role.name}
                  </SelectItem>
                ))}
                {search.role && !customRoles.some((role) => role.key === search.role) && (
                  <SelectItem value={search.role}>{search.role}</SelectItem>
                )}
              </SelectContent>
            </Select>
          )}
          <Select
            value={search.sort ?? "name"}
            onValueChange={(value) =>
              update({ sort: value === "newest" || value === "oldest" ? value : undefined })
            }
          >
            <SelectTrigger aria-label="Sort users" className="min-w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="name">By name</SelectItem>
              <SelectItem value="newest">Newest first</SelectItem>
              <SelectItem value="oldest">Oldest first</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="mt-5 grid grid-cols-2 gap-4 border-t pt-5 sm:grid-cols-4 lg:grid-cols-7">
          {USER_TRAITS.map((trait) => (
            <TraitFilter
              key={trait.key}
              trait={trait}
              value={search[trait.key]}
              onChange={(value) => update({ [trait.key]: value })}
            />
          ))}
        </div>
        {filtered && (
          <div className="mt-5 border-t pt-4">
            <Button
              variant="ghost"
              size="sm"
              className="-ml-2 text-muted-foreground"
              onClick={() => {
                setQuery("");
                void navigate({ search: { sort: search.sort }, replace: true });
              }}
            >
              <X aria-hidden="true" />
              Clear filters
            </Button>
          </div>
        )}
      </Card>

      {data && <MembershipNotice page={data} />}

      {error && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-destructive bg-destructive/5 p-4 text-sm"
        >
          <span>{error}</span>
          <Button variant="outline" size="sm" onClick={() => setRevision((value) => value + 1)}>
            Try again
          </Button>
        </div>
      )}

      {!data && loading ? (
        <ul aria-busy="true" aria-label="Loading users" className="space-y-3">
          {[0, 1, 2, 3].map((index) => (
            <li key={index} className="h-16 animate-pulse rounded-2xl border bg-card" />
          ))}
        </ul>
      ) : data && data.total === 0 ? (
        <Card className="flex flex-col items-center gap-4 px-6 py-14 text-center">
          <div className="flex size-14 items-center justify-center rounded-2xl border bg-background text-primary">
            <Users className="size-6" aria-hidden="true" />
          </div>
          <div>
            <h2 className="text-lg font-semibold">
              {filtered ? "Nobody matches these filters" : "Nobody has signed up yet"}
            </h2>
            <p className="mt-2 max-w-sm text-sm leading-6 text-muted-foreground">
              {filtered
                ? "Try a broader search, or clear some filters."
                : "People appear here after their first sign-in."}
            </p>
          </div>
        </Card>
      ) : data ? (
        <Card className={cn("overflow-hidden", loading && "opacity-60")} aria-busy={loading}>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b bg-muted/40 text-xs text-muted-foreground">
                <tr>
                  <th scope="col" className="px-5 py-3 font-medium">
                    Person
                  </th>
                  <th scope="col" className="px-3 py-3 font-medium">
                    Status
                  </th>
                  <th scope="col" className="px-3 py-3 font-medium">
                    Telegram
                  </th>
                  <th scope="col" className="px-3 py-3 font-medium">
                    Sign-in
                  </th>
                  {data.users.some((user) => user.roles !== null) && (
                    <th scope="col" className="px-3 py-3 font-medium">
                      Roles
                    </th>
                  )}
                  <th scope="col" className="px-5 py-3 text-right font-medium">
                    Joined
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {data.users.map((user) => (
                  <tr
                    key={user.id}
                    className="relative transition-colors focus-within:bg-accent/50 hover:bg-accent/50"
                  >
                    <td className="px-5 py-3">
                      <div className="flex min-w-56 items-center gap-3">
                        <div className="size-9 shrink-0 overflow-hidden rounded-full border bg-muted text-xs font-semibold text-muted-foreground">
                          <UserAvatar name={user.name} image={user.image} />
                        </div>
                        <div className="min-w-0">
                          <Link
                            to="/users/$userId"
                            params={{ userId: user.id }}
                            className="block truncate font-medium outline-none after:absolute after:inset-0"
                          >
                            {user.name}
                          </Link>
                          <p className="truncate text-xs text-muted-foreground">
                            {user.email ?? user.polimiEmail ?? "No email on file"}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <StatusBadges held={held(user.traits)} className="min-w-24" />
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap">
                      {user.traits.telegram ? (
                        <span className="inline-flex items-center gap-1.5 text-xs">
                          <Send className="size-3.5 text-primary" aria-hidden="true" />
                          <span className="font-mono">{user.telegramId ?? "Linked"}</span>
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-3 py-3">
                      <SignInIcons held={held(user.traits)} />
                    </td>
                    {user.roles !== null && (
                      <td className="px-3 py-3">
                        {user.roles.length ? (
                          <div className="flex max-w-56 flex-wrap gap-1.5">
                            {user.roles.map((key) => (
                              <Badge key={key} className="bg-card py-0.5 text-muted-foreground">
                                {roleName(key)}
                              </Badge>
                            ))}
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>
                    )}
                    <td className="px-5 py-3 text-right text-xs whitespace-nowrap text-muted-foreground">
                      {formatDate(user.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}

      {data && data.total > data.pageSize && (
        <nav aria-label="Pages" className="flex items-center justify-between gap-3">
          <Button variant="outline" disabled={data.page === 1} asChild={data.page > 1}>
            {data.page > 1 ? (
              <Link
                from={Route.fullPath}
                search={(previous) => ({ ...previous, page: data.page - 1 })}
              >
                <ChevronLeft aria-hidden="true" />
                Previous
              </Link>
            ) : (
              <>
                <ChevronLeft aria-hidden="true" />
                Previous
              </>
            )}
          </Button>
          <span className="text-sm text-muted-foreground">
            {first}–{last} of {data.total}
          </span>
          <Button variant="outline" disabled={!hasNext} asChild={hasNext}>
            {hasNext ? (
              <Link
                from={Route.fullPath}
                search={(previous) => ({ ...previous, page: data.page + 1 })}
              >
                Next
                <ChevronRight aria-hidden="true" />
              </Link>
            ) : (
              <>
                Next
                <ChevronRight aria-hidden="true" />
              </>
            )}
          </Button>
        </nav>
      )}
    </div>
  );
}
