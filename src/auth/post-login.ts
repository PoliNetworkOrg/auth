import { and, count, eq } from "drizzle-orm";
import { db } from "../db";
import { account, passkey, user } from "../db/schema";
import { needsNameConfirmation } from "./names";

/**
 * Where an app sign-in stops, after signing in and before consent, for the steps below: first
 * confirming a self-declared name, then the passkey offer. Each step continues the sign-in,
 * which comes back here while another step is due.
 */
export const POST_LOGIN_PAGE = "/setup";

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

export type PostLoginState = PasskeyPromptState & {
  /** The person's name is self-declared and was never confirmed (see `names.ts`). */
  nameUnconfirmed: boolean;
};

/** `prompt=none` allows no interaction: stopping at any step would fail the app's silent sign-in. */
function silent(prompt: string | null) {
  return prompt?.split(" ").includes("none") ?? false;
}

/**
 * Whether an app sign-in should stop to confirm the person's name: a self-declared name nobody
 * confirmed yet, whatever the session's age. It's asked again at every sign-in until confirmed.
 */
export function shouldConfirmName(state: Pick<PostLoginState, "nameUnconfirmed" | "prompt">) {
  return state.nameUnconfirmed && !silent(state.prompt);
}

/**
 * Whether an app sign-in should stop to offer a passkey: only to someone who has none and
 * never skipped the offer, and only while their session may still register one.
 */
export function shouldOfferPasskey(state: PasskeyPromptState, now = Date.now()) {
  if (state.hasPasskey || state.declined || state.unsupportedBrowser) return false;
  if (silent(state.prompt)) return false;
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

/** What `postLogin` needs to know about the person, besides the request and the browser. */
export async function readPostLoginState(userId: string) {
  const [passkeys, [names], entra] = await Promise.all([
    readPasskeyPromptState(userId),
    db
      .select({ nameSource: user.nameSource, nameConfirmedAt: user.nameConfirmedAt })
      .from(user)
      .where(eq(user.id, userId)),
    db
      .select({ id: account.id })
      .from(account)
      .where(and(eq(account.userId, userId), eq(account.providerId, "pn-entra")))
      .limit(1),
  ]);
  return {
    ...passkeys,
    // Someone with a PoliNetwork APS account has the directory's name, whatever is stored.
    nameUnconfirmed: !entra.length && !!names && needsNameConfirmation(names),
  };
}

/** Records that the person skipped the offer, so no later sign-in shows it again. */
export async function declinePasskeyPrompt(userId: string) {
  await db.update(user).set({ passkeyPromptDeclinedAt: new Date() }).where(eq(user.id, userId));
}
