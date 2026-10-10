import {
  createFileRoute,
  Link,
  useNavigate,
  useRouter,
  useRouterState,
} from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Info,
  Minus,
  Plus,
  Search,
  Send,
  Slash,
  Users,
  X,
} from "lucide-react";
import { cn } from "cn";
import { emptyCatalog } from "@/auth/rbac";
import { getCatalog } from "@/auth/rbac.functions";
import { getUsers } from "@/auth/users.functions";
import {
  type UserListPage,
  type UserSearch,
  type UserTrait,
  USER_TRAITS,
  hasUserFilters,
  userSearchSchema,
} from "@/auth/users";
import { accessOf, useAccess } from "@/components/access";
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
  // Every filter, the sort, and the page decide what the server returns.
  loaderDeps: ({ search }) => search,
  loader: async ({ context, deps }) => {
    // Role names and the role filter need the catalog, which only role readers may see.
    const [page, catalog] = await Promise.all([
      getUsers({ data: deps }),
      accessOf(context.viewer).can("idp:roles:read") ? getCatalog() : emptyCatalog,
    ]);
    return { page, catalog };
  },
  // A new search keeps the current results on screen, dimmed, rather than swapping the
  // page (and the search box being typed in) for a loading placeholder.
  pendingMs: Infinity,
  component: UsersIndex,
});

const ANY_ROLE = "any";

function formatDate(value: string) {
  return new Date(value).toLocaleDateString(undefined, { dateStyle: "medium" });
}

type Presence = "yes" | "no" | undefined;

/** The order a trait pill steps through on each click. */
const PRESENCE_CYCLE = [undefined, "yes", "no"] as const;

const PRESENCE_STATES = {
  any: {
    Glyph: Slash,
    label: "any",
    short: "any",
    pill: "border-border bg-background text-muted-foreground hover:border-foreground/30 hover:text-foreground",
    glyph: "bg-muted text-muted-foreground",
  },
  yes: {
    Glyph: Plus,
    label: "has it",
    short: "with",
    pill: "border-emerald-600/40 bg-emerald-600/10 text-emerald-700 dark:border-emerald-400/40 dark:text-emerald-300",
    glyph: "bg-emerald-600 text-white dark:bg-emerald-500",
  },
  no: {
    Glyph: Minus,
    label: "does not have it",
    short: "without",
    pill: "border-destructive/40 bg-destructive/10 text-destructive dark:border-red-400/40 dark:text-red-300",
    glyph: "bg-destructive text-white",
  },
} as const;

const presenceState = (value: Presence) => PRESENCE_STATES[value ?? "any"];

/** Steps forward through any, has it, and does not have it; backward with Shift. */
function cyclePresence(value: Presence, backward: boolean): Presence {
  const index = PRESENCE_CYCLE.indexOf(value);
  const step = backward ? PRESENCE_CYCLE.length - 1 : 1;
  return PRESENCE_CYCLE[(index + step) % PRESENCE_CYCLE.length];
}

/** A pill that cycles through any, only people who have it, or only people who do not. */
function TraitFilter({
  trait,
  value,
  onChange,
}: {
  trait: (typeof USER_TRAITS)[number];
  value: Presence;
  onChange: (value: Presence) => void;
}) {
  const Icon = TRAIT_ICONS[trait.key];
  const state = presenceState(value);
  const next = presenceState(cyclePresence(value, false));
  return (
    <button
      type="button"
      onClick={(event) => onChange(cyclePresence(value, event.shiftKey))}
      aria-label={`${trait.label}: ${state.label}`}
      title={`${trait.description}. Click for “${next.label}”, Shift-click to go back.`}
      className={cn(
        "inline-flex h-7 items-center gap-1.5 rounded-full border py-0 pr-2.5 pl-1 text-xs font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
        state.pill,
      )}
    >
      <span
        className={cn("flex size-5 items-center justify-center rounded-full", state.glyph)}
        aria-hidden="true"
      >
        <state.Glyph className="size-3" strokeWidth={3} />
      </span>
      <Icon className="size-3.5" aria-hidden="true" />
      {trait.label}
    </button>
  );
}

/** The three pill states, shown once under the pills. */
function PresenceLegend({ id }: { id: string }) {
  return (
    <p
      id={id}
      className="flex flex-wrap items-center justify-center gap-x-2.5 gap-y-1 text-[10px] text-muted-foreground/70"
    >
      <span className="sr-only">Click a filter to cycle it:</span>
      {Object.values(PRESENCE_STATES).map((state) => (
        <span key={state.label} className="inline-flex items-center gap-1">
          <span
            className={cn(
              "flex size-3 items-center justify-center rounded-full opacity-70",
              state.glyph,
            )}
            aria-hidden="true"
          >
            <state.Glyph className="size-2" strokeWidth={3} />
          </span>
          {state.short}
        </span>
      ))}
    </p>
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
  const router = useRouter();
  const { page: data, catalog } = Route.useLoaderData();
  // Reloading this same page: a new search, filter, or page of results.
  const loading = useRouterState({
    select: (state) =>
      state.isLoading && state.location.pathname === state.resolvedLocation?.pathname,
  });
  const canReadRoles = useAccess().can("idp:roles:read");
  const [query, setQuery] = useState(search.q ?? "");
  const [announcement, setAnnouncement] = useState("");

  const update = (changes: Partial<UserSearch>) =>
    void navigate({
      // Any change to what is shown starts again from the first page.
      search: (previous) => ({ ...previous, page: undefined, ...changes }),
      replace: true,
    });

  // Follow URL changes, including back/forward, when navigation starts. Waiting for the
  // loader to finish would let an older search overwrite what has been typed since.
  useEffect(
    () =>
      router.subscribe("onBeforeNavigate", ({ fromLocation, toLocation }) => {
        const previous = userSearchSchema.parse(fromLocation?.search ?? {}).q;
        const next = userSearchSchema.parse(toLocation.search).q;
        if (previous !== next) setQuery(next ?? "");
      }),
    [router],
  );

  useEffect(() => {
    const term = query.trim() || undefined;
    if (term === search.q) return;
    const timer = setTimeout(() => update({ q: term }), 300);
    return () => clearTimeout(timer);
  }, [query]);

  const customRoles = catalog.roles.filter((role) => !role.managed);
  const roleName = (key: string) => catalog.roles.find((role) => role.key === key)?.name ?? key;
  const filtered = hasUserFilters(search);
  const first = (data.page - 1) * data.pageSize + 1;
  const last = first + data.users.length - 1;
  const hasNext = data.page * data.pageSize < data.total;
  const held = (traits: Record<UserTrait, boolean>) => (trait: UserTrait) => traits[trait];

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">Users</h1>
          <p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground">
            Everyone registered with PoliNetwork Auth, with the accounts they have linked and what
            those accounts prove.
          </p>
        </div>
        <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <Users className="size-4" aria-hidden="true" />
          {data.total} {data.total === 1 ? "person" : "people"}
          {filtered ? " match" : ""}
        </p>
      </div>

      <Card className="p-5 pb-4">
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
        <div className="mt-4 space-y-3 border-t pt-4">
          <div className="flex flex-wrap items-center gap-1.5">
            <div
              role="group"
              aria-label="Filter by trait"
              aria-describedby="trait-filter-legend"
              className="flex flex-wrap gap-1.5"
            >
              {USER_TRAITS.map((trait) => (
                <TraitFilter
                  key={trait.key}
                  trait={trait}
                  value={search[trait.key]}
                  onChange={(value) => {
                    update({ [trait.key]: value });
                    setAnnouncement(`${trait.label}: ${presenceState(value).label}`);
                  }}
                />
              ))}
            </div>
            {filtered && (
              <Button
                variant="secondary"
                size="xs"
                className="h-7 rounded-full px-3"
                onClick={() => {
                  setQuery("");
                  void navigate({ search: { sort: search.sort }, replace: true });
                }}
              >
                <X aria-hidden="true" />
                Clear all
              </Button>
            )}
          </div>
          <PresenceLegend id="trait-filter-legend" />
        </div>
        <p className="sr-only" aria-live="polite">
          {announcement}
        </p>
      </Card>

      <MembershipNotice page={data} />

      {data.total === 0 ? (
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
      ) : (
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
      )}

      {data.total > data.pageSize && (
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
