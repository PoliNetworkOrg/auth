import { env } from "../env";
import { oidcIdentityClaims } from "./policy";
import { resolveUserIdentity } from "./rbac-store";

export const getIdentity = resolveUserIdentity;

export async function getOidcClaims(userId: string, scopes: string[]) {
  if (!scopes.includes("polinetwork:identity")) return {};
  const claimName = new URL("/api/identity", env.BETTER_AUTH_URL).href;
  const identity = await getIdentity(userId);
  return oidcIdentityClaims(claimName, identity);
}
