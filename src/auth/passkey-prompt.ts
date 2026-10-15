import { count, eq } from "drizzle-orm";
import { db } from "../db";
import { passkey, user } from "../db/schema";

/** The page an app sign-in stops at to offer a passkey, after signing in and before consent. */
export const PASSKEY_PROMPT_PAGE = "/passkey";

/**
 * How long after signing in a session may still add a passkey, in seconds. This is Better
 * Auth's default `freshAge`, set explicitly so the offer and the registration agree.
 */
export const SESSION_FRESH_AGE = 60 * 60 * 24;

export type PasskeyPromptState = {
  hasPasskey: boolean;
  declined: boolean;
  /** The browser said it cannot create passkeys (`PASSKEY_UNSUPPORTED_COOKIE`). */
  unsupportedBrowser: boolean;
  sessionCreatedAt: Date;
  /** The authorization request's `prompt` parameter. */
  prompt: string | null;
};

/**
 * Whether an app sign-in should stop to offer a passkey: only to someone who has none and
 * never skipped the offer, and only while their session may still register one.
 */
export function shouldOfferPasskey(state: PasskeyPromptState, now = Date.now()) {
  if (state.hasPasskey || state.declined || state.unsupportedBrowser) return false;
  // `prompt=none` allows no interaction: stopping here would fail the app's silent sign-in.
  if (state.prompt?.split(" ").includes("none")) return false;
  return now - state.sessionCreatedAt.getTime() < SESSION_FRESH_AGE * 1000;
}

export async function readPasskeyPromptState(userId: string) {
  const [row] = await db
    .select({ declinedAt: user.passkeyPromptDeclinedAt, passkeys: count(passkey.id) })
    .from(user)
    .leftJoin(passkey, eq(passkey.userId, user.id))
    .where(eq(user.id, userId))
    .groupBy(user.id);
  return { hasPasskey: (row?.passkeys ?? 0) > 0, declined: row?.declinedAt != null };
}

/** Records that the person skipped the offer, so no later sign-in shows it again. */
export async function declinePasskeyPrompt(userId: string) {
  await db.update(user).set({ passkeyPromptDeclinedAt: new Date() }).where(eq(user.id, userId));
}
