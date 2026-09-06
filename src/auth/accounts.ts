import { and, eq } from "drizzle-orm";
import { account } from "../db/auth-schema";
import { db } from "../db/index";
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
  const accounts = await db
    .select({ id: account.id, providerId: account.providerId })
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
  await db.delete(account).where(and(eq(account.id, accountId), eq(account.userId, userId)));
}
