import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db/index";
import { authorizationMutationLock } from "../db/security-lock";
import { account, identityEvidence, rbacAuditEvent, role, user, userRole } from "../db/schema";
import { contactEmails } from "./contact-email";
import { logAuthorizationDenial } from "./denial-log";
import { readIdentitySubject, refreshIdentityMembership } from "./identity-subject";
import { peopleRoleChangeProblem } from "./people-binding";
import {
  type PeopleBoundRole,
  type PeopleCommand,
  type PeopleCommandResult,
  PeopleCommandConflict,
  describePeopleBoundRoles,
  peopleCommandResult,
  planPeopleCommand,
} from "./people-role-command";
import { expandRoleKeys, resolveAccess } from "./rbac";
import { RbacError, assignedRoleKeys, auditSnapshot, readCatalog } from "./rbac-store";

export type PeopleDirectory = {
  /** Every role People manages, with what holding it means. */
  roles: PeopleBoundRole[];
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
    /**
     * When they were first given each of `roles` (`YYYY-MM-DD`, UTC): the earliest of their
     * current assignments that confers it, directly or through a parent role.
     */
    since: Record<string, string>;
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
      const roles = describePeopleBoundRoles(catalog);
      const boundKeys = new Set(roles.map((entry) => entry.key));
      if (!roles.length) return { roles, users: [] };

      const assignments = await transaction
        .select({ userId: userRole.userId, roleKey: role.key, assignedAt: userRole.assignedAt })
        .from(userRole)
        .innerJoin(role, eq(userRole.roleId, role.id))
        .where(eq(role.managed, false));
      const assigned = new Map<string, string[]>();
      const since = new Map<string, Record<string, string>>();
      for (const row of assignments) {
        assigned.set(row.userId, [...(assigned.get(row.userId) ?? []), row.roleKey]);
        const day = row.assignedAt.toISOString().slice(0, 10);
        const dates = since.get(row.userId) ?? {};
        for (const key of expandRoleKeys(catalog, [row.roleKey]))
          if (boundKeys.has(key) && !(dates[key] && dates[key] <= day)) dates[key] = day;
        since.set(row.userId, dates);
      }
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
          assigned: assigned
            .get(person.id)!
            .filter((key) => boundKeys.has(key))
            .sort(),
          since: since.get(person.id)!,
        })),
      };
    },
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
}

type Reader = Pick<typeof db, "select">;
type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Same command, same canonical form, whatever the key order jsonb stored it in. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}

/**
 * Applies one People command on behalf of a dashboard user: every assignment it needs, or
 * none. The backend names the desired organizational state; Auth plans the concrete
 * assignments against its own graph and checks the actor's own access for each of them
 * with `peopleRoleChangeProblem`. A receipt committed with the assignments makes a retry
 * after a lost response safe: it returns the person's current roles without applying the
 * command again, even if the actor's access has changed since.
 */
export async function changePeopleRoles(input: PeopleCommand): Promise<PeopleCommandResult> {
  const receiptId = `people-command:${input.id}`;
  const current = async (reader: Reader) => {
    const catalog = await readCatalog(reader);
    return peopleCommandResult(catalog, await assignedRoleKeys(input.sub, catalog, reader));
  };
  // Must run after the lock: a concurrent attempt of the same command may be committing.
  const replay = async (reader: Reader) => {
    const [receipt] = await reader
      .select({ operation: rbacAuditEvent.operation, before: rbacAuditEvent.before })
      .from(rbacAuditEvent)
      .where(eq(rbacAuditEvent.id, receiptId));
    if (!receipt) return null;
    if (receipt.operation !== "people.roles" || canonical(receipt.before) !== canonical(input))
      throw new RbacError(409, "This command ID was already used with different input.");
    // The current roles, not those of the receipt: a later change must not be undone in People.
    return current(reader);
  };
  const transaction = <T>(fn: (transaction: Transaction) => Promise<T>) =>
    db.transaction(
      async (transaction) => {
        await transaction.execute(authorizationMutationLock);
        return fn(transaction);
      },
      { isolationLevel: "read committed" },
    );

  const [receipt] = await db
    .select({ id: rbacAuditEvent.id })
    .from(rbacAuditEvent)
    .where(eq(rbacAuditEvent.id, receiptId));
  if (receipt) return transaction(async (tx) => (await replay(tx))!);

  // Before the membership refresh, which throws a plain error for an unknown person.
  const [known] = await db.select({ id: user.id }).from(user).where(eq(user.id, input.actor));
  if (!known) throw new RbacError(403, "The acting person has no account here.");
  await refreshIdentityMembership(input.actor);
  return transaction(async (tx) => {
    const replayed = await replay(tx);
    if (replayed) return replayed;
    const catalog = await readCatalog(tx);
    const [actor] = await tx.select({ id: user.id }).from(user).where(eq(user.id, input.actor));
    if (!actor) throw new RbacError(403, "The acting person has no account here.");
    const [person] = await tx.select({ id: user.id }).from(user).where(eq(user.id, input.sub));
    if (!person) throw new RbacError(404, "That person was not found.");

    let plan;
    try {
      plan = planPeopleCommand(catalog, await assignedRoleKeys(input.sub, catalog, tx), input);
    } catch (error) {
      if (error instanceof PeopleCommandConflict) throw new RbacError(409, error.message);
      throw error;
    }
    const subject = await readIdentitySubject(input.actor, tx);
    const access = resolveAccess(catalog, [
      ...(await assignedRoleKeys(input.actor, catalog, tx)),
      ...subject.roleKeys,
    ]);
    // Every assignment is checked against the actor's access before the first write.
    const steps = plan.changes.map((change) => ({
      ...change,
      target: catalog.roles.find((entry) => entry.key === change.role)!,
    }));
    for (const step of steps) {
      const problem = peopleRoleChangeProblem({
        catalog,
        actorId: input.actor,
        actor: access,
        targetId: input.sub,
        role: step.target,
        action: step.action,
      });
      if (problem) {
        logAuthorizationDenial(input.actor, "people-roles", [`${step.action}:${step.target.key}`]);
        throw new RbacError(403, problem);
      }
    }

    for (const step of steps) {
      const operation = step.action === "assign" ? "role.assign" : "role.unassign";
      const before = await auditSnapshot(tx, catalog, operation, step.target.id);
      if (step.action === "assign")
        await tx
          .insert(userRole)
          .values({ roleId: step.target.id, userId: input.sub, assignedBy: input.actor });
      else
        await tx
          .delete(userRole)
          .where(and(eq(userRole.roleId, step.target.id), eq(userRole.userId, input.sub)));
      const after = await auditSnapshot(tx, catalog, operation, step.target.id);
      await tx.insert(rbacAuditEvent).values({
        id: randomUUID(),
        actorId: input.actor,
        operation,
        targetId: step.target.id,
        before,
        after: {
          ...after,
          via: "people",
          userId: input.sub,
          reason: input.reason,
          commandId: input.id,
        },
      });
    }
    await tx.insert(rbacAuditEvent).values({
      id: receiptId,
      actorId: input.actor,
      operation: "people.roles",
      targetId: input.sub,
      before: input,
      after: plan.result,
    });
    return plan.result;
  });
}
