import { useEffect, useState } from "react";
import { LoaderCircle, Search, UserMinus, UserPlus } from "lucide-react";
import type { RoleMember, UserSearchResult } from "@/auth/rbac";
import {
  changeRoleMember,
  errorMessage,
  fetchRoleMembers,
  searchUsers,
} from "@/components/rbac/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { UserAvatar } from "@/components/user-avatar";

function Person({ name, email, image }: { name: string; email: string; image: string | null }) {
  return (
    <div className="flex min-w-0 flex-1 items-center gap-3">
      <div className="size-9 shrink-0 overflow-hidden rounded-full border bg-muted text-xs font-semibold text-muted-foreground">
        <UserAvatar name={name} image={image} />
      </div>
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{name}</p>
        <p className="truncate text-xs text-muted-foreground">{email}</p>
      </div>
    </div>
  );
}

/** Who holds a role, and the search used to add someone. Only for roles that can be given out. */
export function RoleMembers({ roleId, roleName }: { roleId: string; roleName: string }) {
  const [members, setMembers] = useState<RoleMember[] | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<UserSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [busyUser, setBusyUser] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    fetchRoleMembers(roleId, controller.signal)
      .then(setMembers)
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) setError(errorMessage(cause, "Unable to load members."));
      });
    return () => controller.abort();
  }, [roleId]);

  useEffect(() => {
    const term = query.trim();
    if (!term) {
      setResults([]);
      setSearching(false);
      return;
    }
    const controller = new AbortController();
    setSearching(true);
    const timer = setTimeout(() => {
      searchUsers(term, controller.signal)
        .then((found) => {
          setResults(found);
          setSearching(false);
        })
        .catch((cause: unknown) => {
          if (controller.signal.aborted) return;
          setError(errorMessage(cause, "Unable to search people."));
          setSearching(false);
        });
    }, 250);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [query]);

  async function change(action: "assign" | "unassign", userId: string) {
    setBusyUser(userId);
    setError("");
    try {
      setMembers(await changeRoleMember(action, roleId, userId));
      if (action === "assign") setQuery("");
    } catch (cause) {
      setError(errorMessage(cause, "Unable to change who holds this role."));
    } finally {
      setBusyUser("");
    }
  }

  const held = new Set(members?.map((member) => member.userId));
  const candidates = results.filter((person) => !held.has(person.id));

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
                {results.length ? "Everyone matching already holds this role." : "Nobody matches."}
              </p>
            ) : (
              candidates.map((person) => (
                <div key={person.id} className="flex items-center gap-3 px-4 py-3">
                  <Person name={person.name} email={person.email} image={person.image} />
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busyUser === person.id}
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

      {members === null ? (
        <p className="text-sm text-muted-foreground">Loading members…</p>
      ) : members.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nobody holds {roleName} yet. Search above to give it to someone.
        </p>
      ) : (
        <ul className="divide-y rounded-xl border" aria-label={`People with ${roleName}`}>
          {members.map((member) => (
            <li key={member.userId} className="flex items-center gap-3 px-4 py-3">
              <Person name={member.name} email={member.email} image={member.image} />
              <Button
                size="sm"
                variant="ghost"
                className="text-destructive"
                disabled={busyUser === member.userId}
                onClick={() => void change("unassign", member.userId)}
              >
                {busyUser === member.userId ? (
                  <LoaderCircle className="animate-spin" aria-hidden="true" />
                ) : (
                  <UserMinus aria-hidden="true" />
                )}
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
