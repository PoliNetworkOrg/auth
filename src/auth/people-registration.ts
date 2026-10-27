import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db/index";
import { account, peopleRegistration, rbacAuditEvent, role, user, userRole } from "../db/schema";
import { authorizationMutationLock } from "../db/security-lock";
import { readIdentitySubject, refreshIdentityMembership } from "./identity-subject";
import { peopleRoleChangeProblem } from "./people-binding";
import type {
  CreatePeoplePerson,
  LinkPeoplePerson,
  UpdatePeoplePerson,
} from "./people-registration-command";
import { applyPeopleRoleCommand, canonical } from "./people-roles";
import { MASTER_ADMIN_ROLE_KEY, resolveAccess } from "./rbac";
import { assignedRoleKeys, RbacError, readCatalog } from "./rbac-store";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
async function actorAccess(tx: Transaction, actor: string) {
  const catalog = await readCatalog(tx);
  const subject = await readIdentitySubject(actor, tx);
  const access = resolveAccess(catalog, [
    ...(await assignedRoleKeys(actor, catalog, tx)),
    ...subject.roleKeys,
  ]);
  return { catalog, access };
}
async function refreshActor(actor: string) {
  const [known] = await db.select({ id: user.id }).from(user).where(eq(user.id, actor));
  if (!known) throw new RbacError(403, "The acting person has no account here.");
  await refreshIdentityMembership(actor);
}
async function replay(tx: Transaction, id: string, input: unknown) {
  const [receipt] = await tx.select().from(rbacAuditEvent).where(eq(rbacAuditEvent.id, id));
  if (!receipt) return null;
  if (canonical(receipt.before) !== canonical(input))
    throw new RbacError(409, "Command ID already used with different input.");
  return receipt.after as { sub: string };
}

/** A non-login subject holds real Auth roles; declared contacts never enter identity evidence. */
export async function createPeoplePerson(input: CreatePeoplePerson): Promise<{ sub: string }> {
  await refreshActor(input.actor);
  return db.transaction(async (tx) => {
    await tx.execute(authorizationMutationLock);
    const receiptId = `people-person:${input.id}`;
    const previous = await replay(tx, receiptId, input);
    if (previous) return previous;
    const { catalog, access } = await actorAccess(tx, input.actor);
    if (
      !access.permissions.includes("admin:access") ||
      !access.permissions.includes("people:write")
    )
      throw new RbacError(403, "Creating a person needs people:write and admin:access.");
    for (const change of input.changes) {
      const binding = change.kind === "admin" ? "admin" : `team:${change.team}:${change.role}`;
      if (!catalog.roles.some((entry) => entry.peopleBinding === binding))
        throw new RbacError(409, `Bind an Auth role for ${binding} before assigning it.`);
    }
    const sub = `people:${input.id}`;
    await tx.insert(user).values({
      id: sub,
      name: `${input.firstName} ${input.lastName}`,
      email: `people.${input.id}@identity.invalid`,
      emailVerified: false,
    });
    await tx.insert(peopleRegistration).values({
      id: sub,
      firstName: input.firstName,
      lastName: input.lastName,
      email: input.email || null,
      phone: input.phone || null,
      telegramId: input.telegramId || null,
      telegramUsername: input.telegramUsername || null,
      createdBy: input.actor,
    });
    if (input.changes.length)
      await applyPeopleRoleCommand(tx, {
        id: input.id,
        actor: input.actor,
        sub,
        changes: input.changes,
        reason: "Created preliminary person in Auth",
      });
    const result = { sub };
    await tx.insert(rbacAuditEvent).values({
      id: receiptId,
      actorId: input.actor,
      operation: "people.create",
      targetId: sub,
      before: input,
      after: result,
    });
    return result;
  });
}

/** Master approval transfers only bound roles, never credentials, sessions or provider accounts. */
export async function linkPeoplePerson(input: LinkPeoplePerson): Promise<{ sub: string }> {
  await refreshActor(input.actor);
  return db.transaction(async (tx) => {
    await tx.execute(authorizationMutationLock);
    const receiptId = `people-link:${input.id}`;
    const previous = await replay(tx, receiptId, input);
    if (previous) return previous;
    const { catalog, access } = await actorAccess(tx, input.actor);
    if (!access.roles.includes(MASTER_ADMIN_ROLE_KEY))
      throw new RbacError(403, "A Master Admin must approve this identity link.");
    const [person] = await tx
      .select()
      .from(peopleRegistration)
      .where(eq(peopleRegistration.id, input.personId));
    if (!person) throw new RbacError(404, "Preliminary person not found.");
    if (person.linkedUserId === input.userId) return { sub: input.userId };
    if (person.linkedUserId) throw new RbacError(409, "This person already has a linked account.");
    const [target] = await tx
      .select({ id: account.id })
      .from(account)
      .where(eq(account.userId, input.userId))
      .limit(1);
    const [claimed] = await tx
      .select({ id: peopleRegistration.id })
      .from(peopleRegistration)
      .where(eq(peopleRegistration.linkedUserId, input.userId));
    const [preliminaryTarget] = await tx
      .select({ id: peopleRegistration.id })
      .from(peopleRegistration)
      .where(eq(peopleRegistration.id, input.userId));
    if (!target || claimed || preliminaryTarget)
      throw new RbacError(
        409,
        "Choose an existing login account that is not linked to another preliminary person.",
      );
    const assignments = await tx
      .select({ roleId: userRole.roleId, assignedAt: userRole.assignedAt, key: role.key })
      .from(userRole)
      .innerJoin(role, eq(userRole.roleId, role.id))
      .where(eq(userRole.userId, input.personId));
    for (const assignment of assignments) {
      const assigned = catalog.roles.find((entry) => entry.key === assignment.key);
      if (!assigned) throw new RbacError(409, "An assigned role no longer exists.");
      const problem = peopleRoleChangeProblem({
        catalog,
        actorId: input.actor,
        actor: access,
        targetId: input.userId,
        role: assigned,
        action: "assign",
      });
      if (problem) throw new RbacError(403, problem);
    }
    for (const assignment of assignments)
      await tx
        .insert(userRole)
        .values({
          userId: input.userId,
          roleId: assignment.roleId,
          assignedAt: assignment.assignedAt,
          assignedBy: input.actor,
        })
        .onConflictDoNothing();
    if (assignments.length)
      await tx.delete(userRole).where(
        and(
          eq(userRole.userId, input.personId),
          inArray(
            userRole.roleId,
            assignments.map((entry) => entry.roleId),
          ),
        ),
      );
    await tx
      .update(peopleRegistration)
      .set({ linkedUserId: input.userId })
      .where(eq(peopleRegistration.id, input.personId));
    const result = { sub: input.userId };
    await tx.insert(rbacAuditEvent).values({
      id: receiptId,
      actorId: input.actor,
      operation: "people.link",
      targetId: input.personId,
      before: input,
      after: { ...result, roles: assignments.map((entry) => entry.key) },
    });
    return result;
  });
}

/** Contact corrections stay in Auth; none of these declared values are verification evidence. */
export async function updatePeoplePerson(input: UpdatePeoplePerson): Promise<{ sub: string }> {
  await refreshActor(input.actor);
  return db.transaction(async (tx) => {
    await tx.execute(authorizationMutationLock);
    const receiptId = `people-update:${input.id}`;
    const previous = await replay(tx, receiptId, input);
    if (previous) return previous;
    const { access } = await actorAccess(tx, input.actor);
    if (
      !access.permissions.includes("admin:access") ||
      !access.permissions.includes("people:write")
    )
      throw new RbacError(403, "Changing contacts needs people:write and admin:access.");
    const [person] = await tx
      .select()
      .from(peopleRegistration)
      .where(eq(peopleRegistration.id, input.personId));
    if (!person) throw new RbacError(404, "Auth person not found.");
    await tx
      .update(peopleRegistration)
      .set({
        firstName: input.firstName,
        lastName: input.lastName,
        email: input.email || null,
        phone: input.phone || null,
        telegramId: input.telegramId || null,
        telegramUsername: input.telegramUsername || null,
      })
      .where(eq(peopleRegistration.id, input.personId));
    if (!person.linkedUserId)
      await tx
        .update(user)
        .set({ name: `${input.firstName} ${input.lastName}` })
        .where(eq(user.id, input.personId));
    const result = { sub: person.linkedUserId ?? person.id };
    await tx.insert(rbacAuditEvent).values({
      id: receiptId,
      actorId: input.actor,
      operation: "people.update",
      targetId: person.id,
      before: input,
      after: result,
    });
    return result;
  });
}
