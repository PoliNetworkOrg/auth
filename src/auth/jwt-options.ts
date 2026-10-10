import { resolveSigningKey, type JwtOptions } from "better-auth/plugins/jwt";

/**
 * Shared by the plugin and by direct `signJWT` callers. A caller that omits these mints a
 * replacement key without an expiry once the current key expires, which ends rotation.
 *
 * ID tokens use RS256 because many relying parties (WorkOS, Cloudflare Access) accept
 * nothing else. Our own services keep EdDSA: their resources pin it, and so does the
 * access event sender.
 */
export const jwtOptions = {
  jwks: {
    keyPairConfig: { alg: "RS256", modulusLength: 2048 },
    keyPairConfigs: [{ alg: "EdDSA", crv: "Ed25519" }],
    rotationInterval: 7 * 24 * 60 * 60,
    gracePeriod: 30 * 24 * 60 * 60,
  },
} satisfies JwtOptions;

/**
 * ID tokens sign with the newest RS256 key, but when none is live better-auth falls back
 * to the newest key of any algorithm, which may be EdDSA. Minting the RS256 key first
 * keeps ID tokens on RS256.
 */
export async function ensureIdTokenKey(context: Parameters<typeof resolveSigningKey>[0]) {
  await resolveSigningKey(context, jwtOptions, { signingAlgorithm: "RS256" });
}
