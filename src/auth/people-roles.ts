import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db/index";
import { authorizationMutationLock } from "../db/security-lock";
import { account, identityEvidence, rbacAuditEvent, role, user, userRole } from "../db/schema";
import { contactEmails } from "./contact-email";
import { logAuthorizationDenial } from "./denial-log";
import { readIdentitySubject, refreshIdentityMembership } from "./identity-subject";
import {
  parsePeopleBinding,
  peopleBindingProblem,
  peopleRoleChangeProblem,
} from "./people-binding";
import { expandRoleKeys, resolveAccess } from "./rbac";
import { RbacError, assignedRoleKeys, auditSnapshot, readCatalog } from "./rbac-store";

export type PeopleDirectory = {
  /** Every role People manages, with what holding it means. */
  roles: { key: string; name: string; binding: string }[];
  /** Everyone holding at least one of those roles, by hand or through a parent role. */
  users: {
    sub: string;
    name: string;
    /** Their PoliNetwork address when they linked it, otherwise their sign-in address. */
    email: string | null;
    telegramId: string | null;
    telegramUsername: string | null;
    /** The bound roles they hold, sorted, including through a parent role. */
    roles: string[];
    /** Those of `roles` given to them directly: the only ones that can be taken back. */
    assigned: string[];
  }[];
};

/**
 * Who holds the roles People manages, for the backend's People register. Unlike the access
 * snapshot it includes roles that grant no permission, such as a plain team membership.
 * Roles conferred by identity evidence are never bound, so only assignments count.
 */
export async function readPeopleDirectory(): Promise<PeopleDirectory> {
  return db.transaction(
    async (transaction) => {
      const catalog = await readCatalog(transaction);
      const bound = catalog.roles.filter(
        (entry) => parsePeopleBinding(entry.peopleBinding) && !peopleBindingProblem(catalog, entry),
      );
      const boundKeys = new Set(bound.map((entry) => entry.key));
      const roles = bound.map((entry) => ({
        key: entry.key,
        name: entry.name,
        binding: entry.peopleBinding!,
      }));
      if (!bound.length) return { roles, users: [] };

      const assignments = await transaction
        .select({ userId: userRole.userId, roleKey: role.key })
        .from(userRole)
        .innerJoin(role, eq(userRole.roleId, role.id))
        .where(eq(role.managed, false));
      const assigned = new Map<string, string[]>();
      for (const row of assignments)
        assigned.set(row.userId, [...(assigned.get(row.userId) ?? []), row.roleKey]);
      const held = new Map<string, string[]>();
      for (const [userId, keys] of assigned) {
        const roles = expandRoleKeys(catalog, keys).filter((key) => boundKeys.has(key));
        if (roles.length) held.set(userId, roles);
      }
      const ids = [...held.keys()];
      if (!ids.length) return { roles, users: [] };

      const people = await transaction
        .select({ id: user.id, name: user.name, email: user.email })
        .from(user)
        .where(inArray(user.id, ids))
        .orderBy(user.id);
      const emails = await contactEmails(transaction, people);
      const telegram = await transaction
        .select({
          userId: account.userId,
          telegramId: identityEvidence.telegramId,
          telegramUsername: identityEvidence.telegramUsername,
        })
        .from(account)
        .innerJoin(
          identityEvidence,
          and(
            eq(account.issuer, identityEvidence.issuer),
            eq(account.accountId, identityEvidence.subject),
            eq(account.providerId, identityEvidence.providerId),
          ),
        )
        .where(and(inArray(account.userId, ids), eq(account.providerId, "telegram")));
      const telegramByUser = new Map(telegram.map((row) => [row.userId, row]));

      return {
        roles,
        users: people.map((person) => ({
          sub: person.id,
          name: person.name,
          email: emails.get(person.id) ?? null,
          telegramId: telegramByUser.get(person.id)?.telegramId ?? null,
          telegramUsername: telegramByUser.get(person.id)?.telegramUsername ?? null,
          roles: held.get(person.id)!,
          assigned: (assigned.get(person.id) ?? []).filter((key) => boundKeys.has(key)).sort(),
        })),
      };
    },
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
}

export type PeopleRoleChangeInput = {
  /** The dashboard user the backend acts for, as authenticated by the backend. */
  actorId: string;
  targetId: string;
  roleKey: string;
  action: "assign" | "unassign";
  reason: string;
};

/**
 * Gives or takes back a role People manages, on behalf of a dashboard user. The backend is
 * trusted to name the actor it authenticated, never to decide what that actor may do: the
 * actor's own access is resolved here and checked by `peopleRoleChangeProblem`.
 */
export async function changePeopleRole(input: PeopleRoleChangeInput): Promise<void> {
  // Before the membership refresh, which throws a plain error for an unknown person.
  const [known] = await db.select({ id: user.id }).from(user).where(eq(user.id, input.actorId));
  if (!known) throw new RbacError(403, "The acting person has no account here.");
  await refreshIdentityMembership(input.actorId);
  await db.transaction(
    async (transaction) => {
      await transaction.execute(authorizationMutationLock);
      const catalog = await readCatalog(transaction);
      const target = catalog.roles.find((entry) => entry.key === input.roleKey);
      if (!target) throw new RbacError(404, "Role not found.");
      const [actor] = await transaction
        .select({ id: user.id })
        .from(user)
        .where(eq(user.id, input.actorId));
      if (!actor) throw new RbacError(403, "The acting person has no account here.");
      const [person] = await transaction
        .select({ id: user.id })
        .from(user)
        .where(eq(user.id, input.targetId));
      if (!person) throw new RbacError(404, "That person was not found.");

      const subject = await readIdentitySubject(input.actorId, transaction);
      const access = resolveAccess(catalog, [
        ...(await assignedRoleKeys(input.actorId, catalog, transaction)),
        ...subject.roleKeys,
      ]);
      const problem = peopleRoleChangeProblem({
        catalog,
        actorId: input.actorId,
        actor: access,
        targetId: input.targetId,
        role: target,
        action: input.action,
      });
      if (problem) {
        logAuthorizationDenial(input.actorId, "people-roles", [`${input.action}:${target.key}`]);
        throw new RbacError(403, problem);
      }

      const operation = input.action === "assign" ? "role.assign" : "role.unassign";
      const before = await auditSnapshot(transaction, catalog, operation, target.id);
      const changed =
        input.action === "assign"
          ? await transaction
              .insert(userRole)
              .values({ roleId: target.id, userId: input.targetId, assignedBy: input.actorId })
              .onConflictDoNothing()
              .returning({ userId: userRole.userId })
          : await transaction
              .delete(userRole)
              .where(and(eq(userRole.roleId, target.id), eq(userRole.userId, input.targetId)))
              .returning({ userId: userRole.userId });
      // Already held, or held only through a parent role: nothing happened, so nothing is audited.
      if (!changed.length) return;
      const after = await auditSnapshot(transaction, catalog, operation, target.id);
      await transaction.insert(rbacAuditEvent).values({
        id: randomUUID(),
        actorId: input.actorId,
        operation,
        targetId: target.id,
        before,
        after: { ...after, via: "people", userId: input.targetId, reason: input.reason },
      });
    },
    { isolationLevel: "read committed" },
  );
}
