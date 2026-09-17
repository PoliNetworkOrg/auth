import { and, eq } from "drizzle-orm";
import { db } from "../db/index";
import { account, identityEvidence, user } from "../db/schema";
import { env } from "../env";
import { identityStates } from "./policy";
import { checkEntraGroupMember } from "./membership";
import { canAdministerIdp, createGroupMembershipCache } from "./oidc-admin";
import { MASTER_ADMIN_ROLE_KEY, staticRolesForStates } from "./rbac";

export type IdentityReader = Pick<typeof db, "select">;
export const MEMBERSHIP_CACHE_MS = 60_000;
const member = createGroupMembershipCache(checkEntraGroupMember, MEMBERSHIP_CACHE_MS);

/** The subject is always a persisted user; evidence must match the configured issuer. */
export async function readIdentitySubject(userId: string, reader: IdentityReader) {
  const [subject] = await reader.select({ id: user.id }).from(user).where(eq(user.id, userId));
  if (!subject) throw new Error("Unknown identity subject.");
  const proofs = await reader
    .select({
      issuer: account.issuer,
      providerId: identityEvidence.providerId,
      externalId: identityEvidence.externalId,
      states: identityEvidence.states,
      validUntil: identityEvidence.validUntil,
      telegramId: identityEvidence.telegramId,
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
    .where(eq(account.userId, userId));
  const entraIssuer = env.PN_ENTRA_TENANT_ID
    ? `https://login.microsoftonline.com/${env.PN_ENTRA_TENANT_ID}/v2.0`
    : undefined;
  const trusted = proofs.filter(
    (proof) =>
      (proof.providerId === "polimi-email" && proof.issuer === "https://mail.polimi.it") ||
      (proof.providerId === "telegram" && proof.issuer === "https://oauth.telegram.org"),
  );
  const { states, telegramId } = identityStates(trusted);
  const verifiedStates = new Set(states);
  // Persisted group evidence is display/history data, never an authorization cache.
  // Recheck all group-backed rights with the same short bound, including downstream rights.
  for (const proof of proofs) {
    if (proof.providerId !== "pn-entra" || proof.issuer !== entraIssuer || !proof.externalId)
      continue;
    const groups = [
      ["socio", env.PN_ENTRA_MEMBER_GROUP_ID],
      ["direttivo", env.PN_ENTRA_DIRETTIVO_GROUP_ID],
    ] as const;
    for (const [state, groupId] of groups)
      if (groupId && (await member(groupId, proof.externalId))) verifiedStates.add(state);
  }
  const currentStates = [...verifiedStates].sort();
  const master = await canAdministerIdp(userId, reader);
  return {
    states: currentStates,
    telegramId,
    roleKeys: [...staticRolesForStates(currentStates), ...(master ? [MASTER_ADMIN_ROLE_KEY] : [])],
  };
}
