import { eq } from "drizzle-orm";
import { db } from "../db/index";
import { user } from "../db/schema";
import { env } from "../env";
import { isNameVerified, nameClaims } from "./names";
import { oidcIdentityClaims } from "./policy";
import { resolveUserIdentity } from "./rbac-store";

export const getIdentity = resolveUserIdentity;

function readNames(userId: string) {
  return db
    .select({
      givenName: user.givenName,
      familyName: user.familyName,
      nameSource: user.nameSource,
    })
    .from(user)
    .where(eq(user.id, userId))
    .then(([row]) => row);
}

/**
 * The claims `polinetwork:identity` adds, in the ID token, UserInfo and access tokens. Among them
 * `polinetwork_name_verified`: true only for a name from the association's directory.
 */
export async function getOidcClaims(userId: string, scopes: string[]) {
  if (!scopes.includes("polinetwork:identity")) return {};
  const claimName = new URL("/api/identity", env.BETTER_AUTH_URL).href;
  const [identity, names] = await Promise.all([getIdentity(userId), readNames(userId)]);
  return {
    ...oidcIdentityClaims(claimName, identity),
    polinetwork_name_verified: isNameVerified(names?.nameSource ?? "self"),
  };
}

/**
 * `given_name` and `family_name` for `profile`, from the stored names, in the ID token and
 * UserInfo. They replace the provider's own, which splits `name` at its last space.
 */
export async function getNameClaims(userId: string, scopes: string[]) {
  if (!scopes.includes("profile")) return {};
  const names = await readNames(userId);
  return names ? nameClaims(names) : {};
}
