import { randomUUID } from "node:crypto";
import { and, eq, isNotNull, sql } from "drizzle-orm";
import { db } from "../db/index";
import {
  account,
  identityEvidence,
  oauthClient,
  rbacAuditEvent,
  session,
  user,
} from "../db/schema";
import { env } from "../env";
import { logAuthorizationDenial } from "./denial-log";
import { readIdentitySubject } from "./identity-subject";
import { checkEntraGroupMember, checkPnGroupStates } from "./membership";
import { MASTER_ADMIN_ROLE_KEY, resolveAccess, staticRolesForStates } from "./rbac";
import {
  RbacError,
  assignedRoleKeys,
  withAuthorizedRbacRead,
  withAuthorizedRbacWrite,
} from "./rbac-store";

type Reader = Pick<typeof db, "select">;

/** Entra object IDs of the person's accounts from the configured PoliNetwork tenant. */
async function entraObjectIds(userId: string, reader: Reader): Promise<string[]> {
  if (!env.PN_ENTRA_TENANT_ID) return [];
  const rows = await reader
    .select({ externalId: identityEvidence.externalId })
    .from(account)
    .innerJoin(
      identityEvidence,
      and(
        eq(account.issuer, identityEvidence.issuer),
        eq(account.accountId, identityEvidence.subject),
        eq(account.providerId, identityEvidence.providerId),
      ),
    )
    .where(
      and(
        eq(account.userId, userId),
        eq(account.providerId, "pn-entra"),
        eq(account.issuer, `https://login.microsoftonline.com/${env.PN_ENTRA_TENANT_ID}/v2.0`),
        isNotNull(identityEvidence.externalId),
      ),
    );
  return rows.flatMap((row) => (row.externalId ? [row.externalId] : [])).sort();
}

/**
 * The person's group memberships, confirmed with Graph now rather than read from a cache.
 * Everywhere else a failed check just grants nothing, but here missing a membership would
 * make the person look less privileged than they are, so a failed check refuses instead.
 */
async function confirmedGroupFacts(objectIds: readonly string[]) {
  const states = new Set<string>();
  let masterAdmin = false;
  for (const objectId of objectIds) {
    const groups = await checkPnGroupStates(objectId);
    const admin = env.PN_ENTRA_OIDC_ADMIN_GROUP_ID
      ? await checkEntraGroupMember(env.PN_ENTRA_OIDC_ADMIN_GROUP_ID, objectId)
      : false;
    if (groups === null || admin === null)
      throw new RbacError(
        503,
        "Microsoft Entra could not confirm this person's PoliNetwork groups, so they cannot be deleted right now. Try again shortly.",
      );
    for (const state of groups) states.add(state);
    masterAdmin ||= admin;
  }
  return { states: [...states], masterAdmin };
}

function deny(actorId: string, reason: string, message: string): never {
  logAuthorizationDenial(actorId, "user-deletion", [reason]);
  throw new RbacError(403, message);
}

/**
 * Permanently deletes someone's account: the user row and everything cascading from it
 * (linked accounts, passkeys, sessions, OAuth tokens and consents, role assignments), plus
 * the identity evidence their accounts carried.
 *
 * Deliberately stricter than any other change:
 * - It needs `idp:users:delete`, checked again inside the serialized mutation transaction.
 * - Nobody can delete themselves, and the request must repeat the person's name.
 * - Master Admins cannot be deleted at all, whether configured by ID or through the Entra
 *   group: remove them from the deployment configuration first.
 * - Anyone else deleting must already hold every permission the person holds, so deletion
 *   can never remove access from someone more privileged than the actor.
 * - The person's group memberships are confirmed with Graph first; if that fails, nothing
 *   is deleted.
 * The audit event records what was removed without names, emails, or external identifiers,
 * so the append-only history does not keep the personal data the deletion erases.
 */
export async function deleteUser(actorId: string, userId: string, confirmation: string) {
  if (actorId === userId) throw new RbacError(400, "You cannot delete your own account.");
  // Authorize before contacting Graph about someone else.
  await withAuthorizedRbacRead(actorId, ["idp:users:delete"], async () => undefined);
  if (env.IDP_ADMIN_USER_IDS.includes(userId))
    deny(
      actorId,
      "configured-admin",
      "This person is a configured administrator. Remove them from IDP_ADMIN_USER_IDS first.",
    );
  const objectIds = await entraObjectIds(userId, db);
  const groups = await confirmedGroupFacts(objectIds);

  await withAuthorizedRbacWrite(
    actorId,
    "idp:users:delete",
    async (transaction, catalog, access) => {
      const [target] = await transaction
        .select({ id: user.id, name: user.name, createdAt: user.createdAt })
        .from(user)
        .where(eq(user.id, userId));
      if (!target) throw new RbacError(404, "That person was not found.");
      if (confirmation.trim() !== target.name.trim())
        throw new RbacError(400, "Type the person's name exactly as shown to confirm.");
      // An Entra account linked while Graph was being asked has not been checked.
      const current = await entraObjectIds(userId, transaction);
      if (current.join(" ") !== objectIds.join(" "))
        throw new RbacError(409, "This person's accounts changed while checking. Try again.");

      const subject = await readIdentitySubject(userId, transaction);
      const states = [...new Set([...subject.states, ...groups.states])].sort();
      if (groups.masterAdmin || subject.roleKeys.includes(MASTER_ADMIN_ROLE_KEY))
        deny(
          actorId,
          "master-admin-target",
          "Master Admins cannot be deleted. Remove them from the administrators group first.",
        );
      const held = resolveAccess(catalog, [
        ...(await assignedRoleKeys(userId, catalog, transaction)),
        ...staticRolesForStates(states),
      ]);
      if (
        !access.roles.includes(MASTER_ADMIN_ROLE_KEY) &&
        !held.permissions.every((key) => access.permissions.includes(key))
      )
        deny(
          actorId,
          "bounded-delegation",
          "This person holds access you do not. Ask a Master Admin to delete them.",
        );

      const accounts = await transaction
        .select({
          providerId: account.providerId,
          issuer: account.issuer,
          subject: account.accountId,
        })
        .from(account)
        .where(eq(account.userId, userId));
      await transaction.execute(sql`select set_config('polinetwork.actor_id', ${actorId}, true)`);
      await transaction.insert(rbacAuditEvent).values({
        id: randomUUID(),
        actorId,
        operation: "user.delete",
        targetId: userId,
        before: {
          createdAt: target.createdAt.toISOString(),
          providers: accounts.map((entry) => entry.providerId).sort(),
          states,
          roles: held.roles,
          permissions: held.permissions,
        },
        after: {},
      });
      // Evidence is keyed by external identity rather than by user, so it does not cascade.
      for (const entry of accounts)
        await transaction
          .delete(identityEvidence)
          .where(
            and(
              eq(identityEvidence.issuer, entry.issuer),
              eq(identityEvidence.subject, entry.subject),
              eq(identityEvidence.providerId, entry.providerId),
            ),
          );
      // Applications belong to the shared pool; never let a deletion cascade into them.
      await transaction
        .update(oauthClient)
        .set({ userId: null })
        .where(eq(oauthClient.userId, userId));
      // Core's adapter invokes session deletion hooks, including OAuth token revocation
      // and back-channel logout planning. A cascade alone bypasses those hooks.
      const sessions = await transaction
        .select({ token: session.token })
        .from(session)
        .where(eq(session.userId, userId));
      if (sessions.length) {
        const { auth } = await import("./index");
        const context = await auth.$context;
        await context.internalAdapter.deleteSessions(sessions.map((entry) => entry.token));
      }
      await transaction.delete(user).where(eq(user.id, userId));
    },
  );
}
