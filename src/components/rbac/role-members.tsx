import { Link, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { LoaderCircle, Search, UserMinus, UserPlus } from "lucide-react";
import type { RoleMemberPage, UserSearchResult } from "@/auth/rbac";
import { changeRoleMemberFn, searchPeople } from "@/auth/rbac.functions";
import { useAccess } from "@/components/access";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { UserAvatar } from "@/components/user-avatar";
import { errorMessage } from "@/lib/action-error";

function Person({
  name,
  email,
  image,
}: {
  name: string;
  email: string | null;
  image: string | null;
}) {
  return (
    <div className="flex min-w-0 flex-1 items-center gap-3">
      <div className="size-9 shrink-0 overflow-hidden rounded-full border bg-muted text-xs font-semibold text-muted-foreground">
        <UserAvatar name={name} image={image} />
      </div>
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{name}</p>
        <p className="truncate text-xs text-muted-foreground">{email ?? "No email on file"}</p>
      </div>
    </div>
  );
}

/**
 * Who holds a role, and the search used to add someone. Only for roles that can be given out.
 * The page of members comes from the route loader; `after` is the cursor it was loaded from.
 */
export function RoleMembers({
  roleId,
  roleName,
  canWrite,
  page,
  after,
}: {
  roleId: string;
  roleName: string;
  /** Without it the list is shown but nobody can be added or removed. */
  canWrite: boolean;
  page: RoleMemberPage;
  after: string | undefined;
}) {
  const router = useRouter();
  const { can } = useAccess();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<UserSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [busyUser, setBusyUser] = useState("");
  const [error, setError] = useState("");
  const canSearch = canWrite && can("idp:people:read");
  const members = page.members;

  useEffect(() => {
    const term = query.trim();
    if (!term || !canSearch) {
      setResults([]);
      setSearching(false);
      return;
    }
    let active = true;
    setSearching(true);
    // Results as the person types, not route data, so they are asked for here.
    const timer = setTimeout(() => {
      searchPeople({ data: { query: term, roleId } })
        .then((found) => {
          if (!active) return;
          setResults(found);
          setSearching(false);
        })
        .catch((cause: unknown) => {
          if (!active) return;
          setError(errorMessage(cause, "Unable to search people."));
          setSearching(false);
        });
    }, 250);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [query, canSearch, roleId]);

  async function change(action: "assign" | "unassign", userId: string) {
    setBusyUser(userId);
    setError("");
    try {
      await changeRoleMemberFn({ data: { action, roleId, userId } });
      // Reloads this page's members, the role counts, and the person's own access, which
      // they may just have changed. The button stays busy until the list shows the change,
      // so the person is never missing from both the search and the list.
      await router.invalidate({ sync: true });
      // Marked in place rather than searched again, so someone just taken off the role
      // becomes assignable again without retyping or a flash of "Searching…".
      setResults((found) =>
        found.map((person) =>
          person.id === userId ? { ...person, holdsRole: action === "assign" } : person,
        ),
      );
      if (action === "assign") setQuery("");
    } catch (cause) {
      setError(errorMessage(cause, "Unable to change who holds this role."));
    } finally {
      setBusyUser("");
    }
  }

  const changing = busyUser !== "";
  // The search marks every holder of the role, not just the ones on the page shown below.
  const candidates = results.filter((person) => !person.holdsRole);

  return (
    <div className="space-y-5">
      {error && (
        <p
          role="alert"
          className="rounded-xl border border-destructive bg-destructive/5 p-4 text-sm"
        >
          {error}
        </p>
      )}
      {canSearch && (
        <div className="space-y-3">
          <div className="relative">
            <Search
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search by name or email"
              aria-label={`Find someone to give ${roleName} to`}
              className="pl-9"
            />
          </div>
          {query.trim() && (
            <div className="divide-y rounded-xl border" aria-live="polite">
              {searching ? (
                <p className="px-4 py-5 text-center text-xs text-muted-foreground">Searching…</p>
              ) : candidates.length === 0 ? (
                <p className="px-4 py-5 text-center text-xs text-muted-foreground">
                  {results.length
                    ? "Everyone matching already holds this role."
                    : "Nobody matches."}
                </p>
              ) : (
                candidates.map((person) => (
                  <div key={person.id} className="flex items-center gap-3 px-4 py-3">
                    <Person name={person.name} email={person.email} image={person.image} />
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={changing}
                      onClick={() => void change("assign", person.id)}
                    >
                      {busyUser === person.id ? (
                        <LoaderCircle className="animate-spin" aria-hidden="true" />
                      ) : (
                        <UserPlus aria-hidden="true" />
                      )}
                      Give role
                    </Button>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      )}

      {members.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {canSearch && !after
            ? `Nobody holds ${roleName} yet. Search above to give it to someone.`
            : `Nobody holds ${roleName} yet.`}
        </p>
      ) : (
        <ul className="divide-y rounded-xl border" aria-label={`People with ${roleName}`}>
          {members.map((member) => (
            <li key={member.userId} className="flex items-center gap-3 px-4 py-3">
              <Person name={member.name} email={member.email} image={member.image} />
              {canWrite && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-destructive"
                  disabled={changing}
                  onClick={() => void change("unassign", member.userId)}
                >
                  {busyUser === member.userId ? (
                    <LoaderCircle className="animate-spin" aria-hidden="true" />
                  ) : (
                    <UserMinus aria-hidden="true" />
                  )}
                  Remove
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {(after || page.nextCursor) && (
        <div className="flex items-center justify-between gap-3">
          <Button variant="outline" disabled={changing || !after} asChild={!!after && !changing}>
            {after && !changing ? (
              <Link to="." search={{}}>
                First page
              </Link>
            ) : (
              <span>First page</span>
            )}
          </Button>
          <Button
            variant="outline"
            disabled={changing || !page.nextCursor}
            asChild={!!page.nextCursor && !changing}
          >
            {page.nextCursor && !changing ? (
              <Link to="." search={{ after: page.nextCursor }}>
                Next
              </Link>
            ) : (
              <span>Next</span>
            )}
          </Button>
        </div>
      )}
    </div>
  );
}
