import { and, eq, sql } from "drizzle-orm";
import { account } from "../db/auth-schema";
import { identityEvidence } from "../db/evidence";
import { db } from "../db/index";
import { authorizationMutationLock } from "../db/security-lock";
import { isLoginProvider } from "./policy";

export class AccountError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function disconnectAccount(userId: string, accountId: string) {
  await db.transaction(
    async (transaction) => {
      await transaction.execute(authorizationMutationLock);
      const accounts = await transaction
        .select({
          id: account.id,
          providerId: account.providerId,
          issuer: account.issuer,
          subject: account.accountId,
        })
        .from(account)
        .where(eq(account.userId, userId));
      const selected = accounts.find((candidate) => candidate.id === accountId);
      if (!selected) throw new AccountError(404, "Connected account not found.");
      if (
        isLoginProvider(selected.providerId) &&
        accounts.filter((candidate) => isLoginProvider(candidate.providerId)).length <= 1
      ) {
        throw new AccountError(400, "Connect another login method before disconnecting this one.");
      }
      if (selected.providerId === "telegram")
        await transaction
          .delete(identityEvidence)
          .where(
            and(
              eq(identityEvidence.issuer, selected.issuer),
              eq(identityEvidence.subject, selected.subject),
              eq(identityEvidence.providerId, "telegram"),
            ),
          );
      await transaction.execute(sql`select set_config('polinetwork.actor_id', ${userId}, true)`);
      await transaction
        .delete(account)
        .where(and(eq(account.id, accountId), eq(account.userId, userId)));
    },
    { isolationLevel: "read committed" },
  );
}
