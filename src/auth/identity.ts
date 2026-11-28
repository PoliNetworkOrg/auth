import { eq } from "drizzle-orm";
import { db } from "../db/index";
import { user } from "../db/schema";
import { env } from "../env";
import { isNameVerified, nameClaims } from "./names";
import { oidcIdentityClaims } from "./policy";
import { resolveUserIdentity } from "./rbac-store";

export const getIdentity = resolveUserIdentity;

/** The person's stored names and where they come from, read once per token or UserInfo answer. */
export function readNames(userId: string) {
  return db
    .select({
      givenName: user.givenName,
      familyName: user.familyName,
      nameSource: user.nameSource,
      nameConfirmedAt: user.nameConfirmedAt,
    })
    .from(user)
    .where(eq(user.id, userId))
    .then(([row]) => row);
}

export type StoredNames = Awaited<ReturnType<typeof readNames>>;

/**
 * The claims `polinetwork:identity` adds, in the ID token, UserInfo and access tokens. Among them
 * `polinetwork_name_verified`: true only for a name the association's directory supplied. Pass
 * the names already read for the same answer, so the flag and the names agree.
 */
export async function getOidcClaims(userId: string, scopes: string[], names?: StoredNames) {
  if (!scopes.includes("polinetwork:identity")) return {};
  const claimName = new URL("/api/identity", env.BETTER_AUTH_URL).href;
  const [identity, stored] = await Promise.all([
    getIdentity(userId),
    names === undefined ? readNames(userId) : names,
  ]);
  return {
    ...oidcIdentityClaims(claimName, identity),
    polinetwork_name_verified: !!stored && isNameVerified(stored),
  };
}

/**
 * `given_name` and `family_name` from the stored names, in the ID token and UserInfo, wherever
 * the provider would send its own, which splits `name` at its last space: both with `profile`,
 * and each one a UserInfo request names individually (`claims.userinfo`, OIDC Core §5.5).
 */
export function getNameClaims(names: StoredNames, scopes: string[], requested: string[] = []) {
  if (!names) return {};
  const claims = nameClaims(names);
  if (scopes.includes("profile")) return claims;
  return Object.fromEntries(Object.entries(claims).filter(([key]) => requested.includes(key)));
}

/** Every claim derived from the stored names, from one read: for the ID token and UserInfo. */
export async function getUserClaims(userId: string, scopes: string[], requested: string[] = []) {
  const names = await readNames(userId);
  return {
    ...getNameClaims(names, scopes, requested),
    ...(await getOidcClaims(userId, scopes, names)),
  };
}
