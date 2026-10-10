import { createHash } from "node:crypto";
import { generateRandomString } from "better-auth/crypto";

/**
 * The value `@better-auth/oauth-provider` stores for a client secret with this deployment's
 * settings: `storeClientSecret` left at "hashed" (the default with the JWT plugin) and no
 * secret prefix, so an unpadded base64url SHA-256 digest of the secret itself.
 */
export function hashClientSecret(secret: string) {
  return createHash("sha256").update(secret).digest("base64url");
}

/**
 * A new client secret and the value to store for it, generated as the provider's own
 * rotation endpoint does. The secret is shown once; only `stored` is kept.
 */
export function issueClientSecret() {
  const secret = generateRandomString(32, "a-z", "A-Z");
  return { secret, stored: hashClientSecret(secret) };
}
