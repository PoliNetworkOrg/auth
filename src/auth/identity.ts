import { and, eq } from "drizzle-orm";
import { identityEvidence } from "../db/evidence";
import { db } from "../db/index";
import { account } from "../db/schema";
import { identityClaims } from "./policy";

export async function getIdentity(userId: string) {
  const proofs = await db
    .select({
      providerId: identityEvidence.providerId,
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
