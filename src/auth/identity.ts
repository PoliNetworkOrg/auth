import { and, eq } from "drizzle-orm";
import { identityEvidence } from "../db/evidence";
import { db } from "../db/index";
import { account } from "../db/schema";
import { env } from "../env";
import { identityClaims } from "./policy";
import { checkPnMemberGroup, membershipEvidence } from "./membership";

async function refreshExpiredMembership(userId: string) {
  const now = new Date();
  const stale = await db
    .select({
      issuer: identityEvidence.issuer,
      subject: identityEvidence.subject,
      externalId: identityEvidence.externalId,
      validUntil: identityEvidence.validUntil,
      state: identityEvidence.state,
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
    const member = await checkPnMemberGroup(proof.externalId);
    if (member === null) continue;
    await db
      .update(identityEvidence)
      .set(membershipEvidence(member))
      .where(
        and(eq(identityEvidence.issuer, proof.issuer), eq(identityEvidence.subject, proof.subject)),
      );
  }
}

export async function getIdentity(userId: string) {
  await refreshExpiredMembership(userId);
  const proofs = await db
    .select({
      providerId: identityEvidence.providerId,
      externalId: identityEvidence.externalId,
      state: identityEvidence.state,
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
  return identityClaims(proofs);
}

export async function getOidcClaims(userId: string, scopes: string[]) {
  if (!scopes.includes("polinetwork:identity")) return {};
  return { "https://polinetwork.org/identity": await getIdentity(userId) };
}
