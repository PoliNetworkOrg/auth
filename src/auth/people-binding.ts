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
 * - `capo`: a Capo Admin, who coordinates admins;
 * - `team:<id>:member` / `team:<id>:lead`: a member or the Lead of a volunteer team.
 *
 * Only a bound role can be handed out or taken back by the backend on someone's behalf.
 * Binding one delegates its membership to People, so it needs `idp:people:bind`.
 */
export type PeopleBinding =
  | { kind: "admin" }
  | { kind: "capo" }
  | { kind: "team"; team: string; role: "member" | "lead" };

/** Mirrors the `role_people_binding_check` constraint. */
export const PEOPLE_BINDING_PATTERN = /^(admin|capo|team:[a-z0-9-]{1,32}:(member|lead))$/;

export function parsePeopleBinding(value: string | null | undefined): PeopleBinding | null {
  if (!value || !PEOPLE_BINDING_PATTERN.test(value)) return null;
  if (value === "admin" || value === "capo") return { kind: value };
  const [, team, role] = value.split(":");
  return { kind: "team", team: team!, role: role as "member" | "lead" };
}

export function describePeopleBinding(binding: PeopleBinding) {
  if (binding.kind === "admin") return "Admin of the Telegram groups";
  if (binding.kind === "capo") return "Capo Admin";
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

/** What a delegation rule sees: the change, and one binding the changed role carries. */
export type PeopleRuleContext<B extends PeopleBinding = PeopleBinding> = PeopleRoleChange & {
  binding: B;
  /** Whether the actor holds `admin:access` and `permission`. */
  general: (permission: string) => boolean;
  /** The bindings of the roles the actor holds, including through a parent role. */
  held: PeopleBinding[];
};

type PeopleRule<B extends PeopleBinding> = (context: PeopleRuleContext<B>) => string | null;

const NEEDS_WRITE = "Changing this role needs people:write and admin:access.";
const NEEDS_WRITE_OR_LEAD =
  "Changing this role needs people:write and admin:access, or leading the team.";
const NEEDS_APPOINT = "Appointing or ending a Lead needs people:appoint and admin:access.";
const NEEDS_APPOINT_CAPO =
  "Appointing or ending a Capo Admin needs people:appoint and admin:access.";

/**
 * Who may give or take back a role, one rule per binding kind. A rule answers why not, or
 * null when the actor may. Self-grants, `idp:*` rights and bounded delegation are checked
 * around the rules, for every kind alike.
 *
 * A future rule such as "a Capo Admin may add or remove the admins under them" belongs in
 * `admin`, as another way to be allowed, once Auth can verify which admins are under whom.
 */
export const PEOPLE_RULES: {
  [K in PeopleBinding["kind"]]: PeopleRule<Extract<PeopleBinding, { kind: K }>>;
} = {
  admin: ({ general }) => (general(PEOPLE_WRITE_PERMISSION) ? null : NEEDS_WRITE),
  capo: ({ general }) => (general(PEOPLE_APPOINT_PERMISSION) ? null : NEEDS_APPOINT_CAPO),
  team: ({ binding, general, held }) => {
    if (binding.role === "lead") return general(PEOPLE_APPOINT_PERMISSION) ? null : NEEDS_APPOINT;
    // A team's Lead may also add and remove that team's members.
    const leads = held.some(
      (entry) => entry.kind === "team" && entry.team === binding.team && entry.role === "lead",
    );
    return general(PEOPLE_WRITE_PERMISSION) || leads ? null : NEEDS_WRITE_OR_LEAD;
  },
};

function ruleProblem(context: PeopleRuleContext): string | null {
  const rule = PEOPLE_RULES[context.binding.kind] as PeopleRule<PeopleBinding>;
  return rule(context);
}

/**
 * Whether the backend may change who holds `role` on the actor's behalf; a reason when not.
 *
 * - Only bound roles, and only while they carry no `idp:*` permission.
 * - Nobody gives themselves a role. Giving one up is always allowed: it only removes access.
 * - The rule of the role's binding kind, and of every binding it inherits: a member role
 *   wrapping a Lead role needs what the Lead role needs. See `PEOPLE_RULES`.
 * - Bounded delegation, as in the dashboard: unless Master Admin, the actor must already hold
 *   every permission the role grants, so nobody hands out more than they have.
 */
export function peopleRoleChangeProblem(change: PeopleRoleChange): string | null {
  const { catalog, actorId, actor, targetId, role, action } = change;
  if (!parsePeopleBinding(role.peopleBinding)) return "This role is not managed from People.";
  const problem = peopleBindingProblem(catalog, role);
  if (problem) return problem;
  if (actorId === targetId)
    return action === "unassign" ? null : "Nobody can give themselves a role.";

  const holds = (key: string) => actor.permissions.includes(key);
  const general = (key: string) => holds(ADMIN_ACCESS_PERMISSION) && holds(key);
  const bindingsOf = (keys: string[]) =>
    keys.flatMap((key) => {
      const binding = parsePeopleBinding(
        catalog.roles.find((entry) => entry.key === key)?.peopleBinding,
      );
      return binding ? [binding] : [];
    });
  const held = bindingsOf(actor.roles);
  // A role grants organizational authority through every inherited binding as well as
  // through permissions. A member wrapper around a Lead must require appointment rights.
  // The role's own rule first, so a refusal names what the role itself needs.
  const inherited = expandRoleKeys(catalog, [role.key]).filter((key) => key !== role.key);
  for (const binding of bindingsOf([role.key, ...inherited])) {
    const refused = ruleProblem({ ...change, binding, general, held });
    if (refused) return refused;
  }

  if (actor.roles.includes(MASTER_ADMIN_ROLE_KEY)) return null;
  const missing = effectiveRolePermissions(catalog, role.key).filter((key) => !holds(key));
  return missing.length
    ? `This role grants permissions you do not hold (${missing.join(", ")}).`
    : null;
}
