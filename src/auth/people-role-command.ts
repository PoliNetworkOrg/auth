import { z } from "zod";
import { parsePeopleBinding, peopleBindingProblem } from "./people-binding";
import { effectiveRolePermissions, expandRoleKeys, type RbacCatalog } from "./rbac";

/**
 * One People command from the backend. Each change names a desired state for one concept.
 * Unknown fields are stripped, so a later optional field (for example the scope a Capo Admin
 * acts in) can be sent before every Auth deployment reads it: an Auth that ignores it only
 * applies the stricter rules it already has.
 */
export const peopleCommandSchema = z
  .object({
    id: z.uuid(),
    actor: z.string().min(1).max(200),
    sub: z.string().min(1).max(200),
    reason: z.string().trim().min(1).max(500),
    changes: z
      .array(
        z.discriminatedUnion("kind", [
          z.object({ kind: z.literal("admin"), active: z.boolean() }),
          z.object({ kind: z.literal("capo"), active: z.boolean() }),
          z.object({
            kind: z.literal("team"),
            team: z.string().regex(/^[a-z0-9-]{1,32}$/),
            role: z.enum(["member", "lead"]).nullable(),
          }),
        ]),
      )
      .min(1)
      .max(64),
  })
  .superRefine((command, ctx) => {
    const keys = command.changes.map((c) => (c.kind === "team" ? `team:${c.team}` : c.kind));
    if (new Set(keys).size !== keys.length)
      ctx.addIssue({ code: "custom", message: "Each concept may appear only once" });
  });
export type PeopleCommand = z.infer<typeof peopleCommandSchema>;
/**
 * A role bound to People, as the backend sees it. `permissions` and `bindings` let it apply
 * `peopleRoleChangeProblem`'s rules itself to assignments it keeps before a record is linked,
 * which this identity provider only sees at link time.
 */
export type PeopleBoundRole = {
  key: string;
  name: string;
  binding: string;
  /** Every permission the role grants, including through parent roles, sorted. */
  permissions: string[];
  /** Its own binding, then those of the roles it inherits. */
  bindings: string[];
};
export type PeopleCommandResult = {
  roles: PeopleBoundRole[];
  held: string[];
  assigned: string[];
};

export class PeopleCommandConflict extends Error {}

export function peopleBoundRoles(catalog: RbacCatalog) {
  return catalog.roles.filter(
    (r) => parsePeopleBinding(r.peopleBinding) && !peopleBindingProblem(catalog, r),
  );
}

/** The bound roles, with what `peopleRoleChangeProblem` checks for each of them. */
export function describePeopleBoundRoles(catalog: RbacCatalog): PeopleBoundRole[] {
  return peopleBoundRoles(catalog).map((r) => {
    const inherited = expandRoleKeys(catalog, [r.key]).flatMap((key) => {
      const binding = catalog.roles.find((entry) => entry.key === key)?.peopleBinding;
      return key !== r.key && parsePeopleBinding(binding) ? [binding!] : [];
    });
    return {
      key: r.key,
      name: r.name,
      binding: r.peopleBinding!,
      permissions: effectiveRolePermissions(catalog, r.key),
      bindings: [r.peopleBinding!, ...inherited],
    };
  });
}

export function peopleCommandResult(catalog: RbacCatalog, assigned: string[]): PeopleCommandResult {
  const roles = describePeopleBoundRoles(catalog);
  const keys = new Set(roles.map((r) => r.key));
  return {
    roles,
    held: expandRoleKeys(catalog, assigned).filter((key) => keys.has(key)),
    assigned: assigned.filter((key) => keys.has(key)).sort(),
  };
}

/** Plan the entire command against Auth's graph, before writing any assignment. */
export function planPeopleCommand(
  catalog: RbacCatalog,
  assigned: string[],
  command: PeopleCommand,
) {
  const bound = peopleBoundRoles(catalog);
  const next = new Set(assigned);
  const held = () => new Set(expandRoleKeys(catalog, [...next]));
  const keysFor = (binding: string) =>
    bound.filter((r) => r.peopleBinding === binding).map((r) => r.key);
  const remove = (keys: string[]) => {
    for (const key of keys) next.delete(key);
  };
  const give = (keys: string[], concept: string) => {
    if (keys.some((key) => held().has(key))) return;
    // An ambiguous mapping must be decided in Auth, never by alphabetic order.
    if (keys.length !== 1)
      throw new PeopleCommandConflict(`Choose exactly one assignable role for ${concept} in Auth.`);
    next.add(keys[0]!);
  };
  for (const change of command.changes) {
    if (change.kind !== "team") {
      const keys = keysFor(change.kind);
      if (!keys.length) continue; // An unbound concept remains local to People.
      if (change.active) give(keys, change.kind);
      else remove(keys);
    } else {
      const members = keysFor(`team:${change.team}:member`);
      const leads = keysFor(`team:${change.team}:lead`);
      if (!members.length && !leads.length) continue;
      if (change.role !== "lead") remove(leads);
      if (change.role === null) remove(members);
      else give(change.role === "lead" ? leads : members, `${change.team}:${change.role}`);
    }
  }
  const result = peopleCommandResult(catalog, [...next]);
  // Removing a direct assignment may leave the same authority through another role.
  // Refuse the whole command rather than reporting a revocation that never happened.
  for (const change of command.changes) {
    const has = (binding: string) =>
      bound.some((r) => r.peopleBinding === binding && result.held.includes(r.key));
    if (change.kind !== "team") {
      if (keysFor(change.kind).length && has(change.kind) !== change.active)
        throw new PeopleCommandConflict(
          `The ${change.kind} role is inherited. Change its granting role in Auth.`,
        );
    } else {
      if (!bound.some((r) => r.peopleBinding?.startsWith(`team:${change.team}:`))) continue;
      const actual = has(`team:${change.team}:lead`)
        ? "lead"
        : has(`team:${change.team}:member`)
          ? "member"
          : null;
      if (actual !== change.role)
        throw new PeopleCommandConflict(
          `The ${change.team} role is inherited. Change its granting role in Auth.`,
        );
    }
  }
  return {
    result,
    changes: [
      ...assigned
        .filter((key) => !next.has(key))
        .map((role) => ({ role, action: "unassign" as const })),
      ...[...next]
        .filter((key) => !assigned.includes(key))
        .map((role) => ({ role, action: "assign" as const })),
    ],
  };
}
