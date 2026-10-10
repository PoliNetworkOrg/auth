import { and, eq, inArray } from "drizzle-orm";
import { decodeJwt } from "jose";
import { z } from "zod";
import type { db } from "../db/index";
import { account, identityEvidence } from "../db/schema";
import { isPlaceholderEmail } from "./users";

type Reader = Pick<typeof db, "select">;

export type SignInToken = {
  providerId: string;
  idToken: string | null;
  /** The address saved at the account's last sign-in, when there is one. */
  email?: string | null;
};

// Google first: it is the address people chose to sign in with.
const EMAIL_PROVIDERS = ["google", "pn-entra"];

function realEmail(value: unknown) {
  const parsed = z.email().safeParse(value);
  return parsed.success && !isPlaceholderEmail(parsed.data) ? parsed.data : undefined;
}

/** The address in a sign-in token's claims, if it carries a real one. */
export function claimEmail(claims: { [claim: string]: unknown }) {
  for (const candidate of [claims.email, claims.preferred_username, claims.upn]) {
    const address = realEmail(candidate);
    if (address) return address;
  }
  return undefined;
}

/**
 * The address to show for someone. PoliNetwork and Telegram sign-ins store a placeholder
 * email, so this falls back to the address saved at their last sign-in, then to the one in
 * the ID token, for accounts that have not signed in since addresses were saved. Those tokens were accepted during OAuth sign-in, and their claims are used only as
 * display labels, never to identify a user or grant permissions.
 */
export function contactEmail(email: string, tokens: SignInToken[]) {
  const stored = realEmail(email);
  if (stored) return stored;
  for (const provider of EMAIL_PROVIDERS) {
    for (const token of tokens) {
      if (token.providerId !== provider) continue;
      const saved = realEmail(token.email);
      if (saved) return saved;
      if (!token.idToken) continue;
      let claims;
      try {
        claims = decodeJwt(token.idToken);
      } catch {
        continue;
      }
      const address = claimEmail(claims);
      if (address) return address;
    }
  }
  return undefined;
}

/** `contactEmail` for many people at once, keyed by user ID. Null when none is known. */
export async function contactEmails(
  reader: Reader,
  people: { id: string; email: string }[],
): Promise<Map<string, string | null>> {
  const missing = people.filter((person) => isPlaceholderEmail(person.email));
  const tokens = missing.length
    ? await reader
        .select({
          userId: account.userId,
          providerId: account.providerId,
          idToken: account.idToken,
          email: identityEvidence.email,
        })
        .from(account)
        .leftJoin(
          identityEvidence,
          and(
            eq(account.issuer, identityEvidence.issuer),
            eq(account.accountId, identityEvidence.subject),
            eq(account.providerId, identityEvidence.providerId),
          ),
        )
        .where(
          and(
            inArray(
              account.userId,
              missing.map((person) => person.id),
            ),
            inArray(account.providerId, EMAIL_PROVIDERS),
          ),
        )
    : [];
  return new Map(
    people.map((person) => [
      person.id,
      contactEmail(
        person.email,
        tokens.filter((token) => token.userId === person.id),
      ) ?? null,
    ]),
  );
}

/**
 * The address apps receive in the `email` claim. A linked polinetwork.org address comes
 * first, because some apps (Claude, Cloudflare) only let in those accounts. Apps may
 * identify people by it: it comes from a verified sign-in to PoliNetwork's own Entra
 * tenant, where only administrators hand out polinetwork.org addresses. Placeholders are
 * never sent.
 */
export async function appEmail(
  reader: Reader,
  user: { id: string; email: string; emailVerified: boolean },
) {
  const linked = await reader
    .select({ email: identityEvidence.email })
    .from(account)
    .innerJoin(
      identityEvidence,
      and(
        eq(account.issuer, identityEvidence.issuer),
        eq(account.accountId, identityEvidence.subject),
        eq(account.providerId, identityEvidence.providerId),
      ),
    )
    .where(and(eq(account.userId, user.id), eq(account.providerId, "pn-entra")));
  const organization = linked
    .map((row) => row.email)
    .find((email) => email?.toLowerCase().endsWith("@polinetwork.org"));
  if (organization) return { email: organization, emailVerified: true };
  if (isPlaceholderEmail(user.email)) return { email: null, emailVerified: false };
  return { email: user.email, emailVerified: user.emailVerified };
}
