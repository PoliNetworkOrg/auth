// Shared by the server and the browser: keep this file free of server-only imports.
import {
  type RbacCatalog,
  type ResolvedAccess,
  type RoleSummary,
  MASTER_ADMIN_ROLE_KEY,
  effectiveRolePermissions,
  expandRoleKeys,
  isManagedPermissionKey,
} from "./rbac";

/**
 * What holding a role means in the People register of the admin dashboard:
 * - `admin`: an admin of the Telegram course groups;
 * - `team:<id>:member` / `team:<id>:lead`: a member or the Lead of a volunteer team.
 *
 * Only a bound role can be handed out or taken back by the backend on someone's behalf, and
 * only Master Admin binds a role, because binding one delegates its membership to People.
 */
export type PeopleBinding =
  | { kind: "admin" }
  | { kind: "team"; team: string; role: "member" | "lead" };

/** Mirrors the `role_people_binding_check` constraint. */
export const PEOPLE_BINDING_PATTERN = /^(admin|team:[a-z0-9-]{1,32}:(member|lead))$/;

export function parsePeopleBinding(value: string | null | undefined): PeopleBinding | null {
  if (!value || !PEOPLE_BINDING_PATTERN.test(value)) return null;
  if (value === "admin") return { kind: "admin" };
  const [, team, role] = value.split(":");
  return { kind: "team", team: team!, role: role as "member" | "lead" };
}

export function describePeopleBinding(binding: PeopleBinding) {
  if (binding.kind === "admin") return "Admin of the Telegram groups";
  return `${binding.role === "lead" ? "Lead" : "Member"} of team ${binding.team}`;
}

/**
 * Why a role can't be bound, or null when it can. A bound role must stay below this identity
 * provider's own permissions: People writers must never be able to hand out `idp:*` rights.
 */
export function peopleBindingProblem(catalog: RbacCatalog, role: RoleSummary): string | null {
  if (role.managed) return "Roles defined by the identity provider cannot be managed from People.";
  if (effectiveRolePermissions(catalog, role.key).some(isManagedPermissionKey))
    return "This role grants permissions of the identity provider itself, so People can't manage it.";
  return null;
}

/** The permissions that let a dashboard user change who holds a bound role, besides `admin:access`. */
export const PEOPLE_WRITE_PERMISSION = "people:write";
export const PEOPLE_APPOINT_PERMISSION = "people:appoint";
export const ADMIN_ACCESS_PERMISSION = "admin:access";

export type PeopleRoleChange = {
  catalog: RbacCatalog;
  actorId: string;
  /** Everything the actor holds, from assignments and identity evidence. */
  actor: ResolvedAccess;
  targetId: string;
  role: RoleSummary;
  action: "assign" | "unassign";
};

/**
 * Whether the backend may change who holds `role` on the actor's behalf; a reason when not.
 *
 * - Only bound roles, and only while they carry no `idp:*` permission.
 * - Nobody gives themselves a role. Giving one up is always allowed: it only removes access.
 * - Admin and team member roles need `people:write`; a team's Lead may also add and remove
 *   that team's members. Lead roles need `people:appoint`. Both need `admin:access`, except
 *   for a Lead acting on their own team.
 * - Bounded delegation, as in the dashboard: unless Master Admin, the actor must already hold
 *   every permission the role grants, so nobody hands out more than they have.
 */
export function peopleRoleChangeProblem(change: PeopleRoleChange): string | null {
  const { catalog, actorId, actor, targetId, role, action } = change;
  const binding = parsePeopleBinding(role.peopleBinding);
  if (!binding) return "This role is not managed from People.";
  const problem = peopleBindingProblem(catalog, role);
  if (problem) return problem;
  if (actorId === targetId)
    return action === "unassign" ? null : "Nobody can give themselves a role.";

  const holds = (key: string) => actor.permissions.includes(key);
  const general = (key: string) => holds(ADMIN_ACCESS_PERMISSION) && holds(key);
  const leadsTeam = (team: string) =>
    actor.roles.some((key) => {
      const held = parsePeopleBinding(
        catalog.roles.find((entry) => entry.key === key)?.peopleBinding,
      );
      return held?.kind === "team" && held.team === team && held.role === "lead";
    });
  // A role grants organizational authority through every inherited binding as well as
  // through permissions. A member wrapper around a Lead must require appointment rights.
  for (const key of expandRoleKeys(catalog, [role.key])) {
    const inherited = parsePeopleBinding(
      catalog.roles.find((entry) => entry.key === key)?.peopleBinding,
    );
    if (!inherited) continue;
    const allowed =
      inherited.kind === "admin"
        ? general(PEOPLE_WRITE_PERMISSION)
        : inherited.role === "lead"
          ? general(PEOPLE_APPOINT_PERMISSION)
          : general(PEOPLE_WRITE_PERMISSION) || leadsTeam(inherited.team);
    if (!allowed)
      return inherited.kind === "team" && inherited.role === "lead"
        ? "Appointing or ending a Lead needs people:appoint and admin:access."
        : "Changing this role needs people:write and admin:access, or leading the team.";
  }

  if (actor.roles.includes(MASTER_ADMIN_ROLE_KEY)) return null;
  const missing = effectiveRolePermissions(catalog, role.key).filter((key) => !holds(key));
  return missing.length
    ? `This role grants permissions you do not hold (${missing.join(", ")}).`
    : null;
}
