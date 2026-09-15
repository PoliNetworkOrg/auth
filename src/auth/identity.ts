import { and, eq } from "drizzle-orm";
import { identityEvidence } from "../db/evidence";
import { db } from "../db/index";
import { account } from "../db/schema";
import { env } from "../env";
import { type IdentityClaims, identityStates, oidcIdentityClaims } from "./policy";
import { checkPnGroupStates, membershipEvidence } from "./membership";
import { MASTER_ADMIN_ROLE_KEY } from "./rbac";
import { resolveUserAccess } from "./rbac-store";
import { canAdministerIdp } from "./oidc-admin";

async function refreshExpiredMembership(userId: string) {
  const now = new Date();
  const stale = await db
    .select({
      issuer: identityEvidence.issuer,
      subject: identityEvidence.subject,
      externalId: identityEvidence.externalId,
      validUntil: identityEvidence.validUntil,
    })
    .from(account)
    .innerJoin(
      identityEvidence,
      and(
        eq(account.issuer, identityEvidence.issuer),
        eq(account.accountId, identityEvidence.subject),
      ),
    )
    .where(eq(account.userId, userId));

  for (const proof of stale) {
    if (proof.issuer !== `https://login.microsoftonline.com/${env.PN_ENTRA_TENANT_ID}/v2.0`)
      continue;
    if (proof.validUntil > now || !proof.externalId) continue;
    const states = await checkPnGroupStates(proof.externalId);
    if (states === null) continue;
    await db
      .update(identityEvidence)
      .set(membershipEvidence(states))
      .where(
        and(eq(identityEvidence.issuer, proof.issuer), eq(identityEvidence.subject, proof.subject)),
      );
  }
}

export async function getIdentity(userId: string): Promise<IdentityClaims> {
  await refreshExpiredMembership(userId);
  const proofs = await db
    .select({
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
      ),
    )
    .where(eq(account.userId, userId));
  const { states, telegramId } = identityStates(proofs);
  // Master Admin is configured outside the database, so it is conferred here rather than
  // proven by evidence, and never appears among the states.
  const conferred = (await canAdministerIdp(userId)) ? [MASTER_ADMIN_ROLE_KEY] : [];
  const access = await resolveUserAccess(userId, states, conferred);
  return { states, roles: access.roles, permissions: access.permissions, telegramId };
}

export async function getOidcClaims(userId: string, scopes: string[]) {
  if (!scopes.includes("polinetwork:identity")) return {};
  const claimName = new URL("/api/identity", env.BETTER_AUTH_URL).href;
  const identity = await getIdentity(userId);
  return oidcIdentityClaims(claimName, identity);
}
