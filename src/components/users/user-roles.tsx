import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { LoaderCircle, ShieldCheck, Sparkles, UserMinus, UserPlus } from "lucide-react";
import type { RbacCatalog } from "@/auth/rbac";
import type { UserRoleAssignment } from "@/auth/users";
import { useIdpAccessContext } from "@/components/idp-access";
import { changeRoleMember, errorMessage } from "@/components/rbac/api";
import { canGrantRole } from "@/components/rbac/delegation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

function formatDate(value: string | null) {
  return value ? new Date(value).toLocaleDateString(undefined, { dateStyle: "medium" }) : null;
}

/**
 * The roles given to one person by hand, with the controls to give or take them away. It
 * uses the same endpoint as a role's member list, so the server applies the same bounded
 * delegation: nobody can hand out, or take away, access they do not hold themselves.
 */
export function UserRoles({
  userId,
  userName,
  assigned,
  held,
  catalog,
  onChanged,
}: {
  userId: string;
  userName: string;
  assigned: UserRoleAssignment[];
  /** Every role they hold, including built-in and inherited ones. */
  held: string[];
  catalog: RbacCatalog;
  onChanged: () => void;
}) {
  const access = useIdpAccessContext();
  const canWrite = access.can("idp:roles:assign");
  const [choice, setChoice] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const roleByKey = (key: string) => catalog.roles.find((role) => role.key === key);
  const mayGrant = (key: string) => canGrantRole(access, catalog, key);
  const available = catalog.roles
    .filter((role) => !role.managed && !assigned.some((entry) => entry.key === role.key))
    .sort((a, b) => a.name.localeCompare(b.name));
  // Held through a built-in role or inheritance rather than given by hand.
  const other = held.filter((key) => !assigned.some((entry) => entry.key === key));

  async function change(action: "assign" | "unassign", key: string) {
    const target = roleByKey(key);
    if (!target) return;
    setBusy(key);
    setError("");
    try {
      await changeRoleMember(action, target.id, userId);
      if (action === "assign") setChoice("");
      onChanged();
      // They may have changed their own access.
      access.retry();
    } catch (cause) {
      setError(errorMessage(cause, "Unable to change this person's roles."));
    } finally {
      setBusy("");
    }
  }

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

      {assigned.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nobody has given {userName} a role by hand.</p>
      ) : (
        <ul className="divide-y rounded-xl border" aria-label={`Roles given to ${userName}`}>
          {assigned.map((entry) => {
            const role = roleByKey(entry.key);
            const assignedAt = formatDate(entry.assignedAt);
            return (
              <li key={entry.key} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <ShieldCheck className="size-4 shrink-0 text-primary" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  {role ? (
                    <Link
                      to="/access/roles/$roleId"
                      params={{ roleId: role.id }}
                      className="text-sm font-medium hover:underline"
                    >
                      {entry.name}
                    </Link>
                  ) : (
                    <p className="text-sm font-medium">{entry.name}</p>
                  )}
                  <p className="truncate text-xs text-muted-foreground">
                    {assignedAt ? `Given ${assignedAt}` : "Given"}
                    {entry.assignedBy
                      ? ` by ${entry.assignedBy.name ?? `a removed user (${entry.assignedBy.id})`}`
                      : ""}
                  </p>
                </div>
                {canWrite && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive"
                    disabled={busy !== "" || !mayGrant(entry.key)}
                    title={
                      mayGrant(entry.key)
                        ? undefined
                        : "This role grants permissions you do not hold. Ask Master Admin."
                    }
                    onClick={() => void change("unassign", entry.key)}
                  >
                    {busy === entry.key ? (
                      <LoaderCircle className="animate-spin" aria-hidden="true" />
                    ) : (
                      <UserMinus aria-hidden="true" />
                    )}
                    Remove
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {canWrite && (
        <div className="flex flex-wrap items-center gap-3">
          <Select value={choice} onValueChange={setChoice} disabled={available.length === 0}>
            <SelectTrigger aria-label={`Choose a role to give ${userName}`} className="min-w-56">
              <SelectValue
                placeholder={available.length ? "Choose a role" : "No other roles to give"}
              />
            </SelectTrigger>
            <SelectContent>
              {available.map((role) => (
                <SelectItem key={role.id} value={role.key} disabled={!mayGrant(role.key)}>
                  {role.name}
                  {!mayGrant(role.key) && " · needs access you do not hold"}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            disabled={!choice || busy !== ""}
            onClick={() => void change("assign", choice)}
          >
            {busy === choice && choice ? (
              <LoaderCircle className="animate-spin" aria-hidden="true" />
            ) : (
              <UserPlus aria-hidden="true" />
            )}
            Give role
          </Button>
        </div>
      )}

      {other.length > 0 && (
        <div className="space-y-2 border-t pt-5">
          <p className="text-xs font-medium text-muted-foreground">
            Also held automatically or through inheritance
          </p>
          <div className="flex flex-wrap gap-1.5">
            {other.map((key) => {
              const role = roleByKey(key);
              return (
                <Badge key={key} className="bg-card text-muted-foreground">
                  {role?.managed && <Sparkles className="size-3 text-primary" aria-hidden="true" />}
                  {role?.name ?? key}
                </Badge>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
