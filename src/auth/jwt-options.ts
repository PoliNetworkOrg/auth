import type { JwtOptions } from "better-auth/plugins/jwt";

/**
 * Shared by the plugin and by direct `signJWT` callers. A caller that omits these mints a
 * replacement key without an expiry once the current key expires, which ends rotation.
 */
export const jwtOptions = {
  jwks: { rotationInterval: 7 * 24 * 60 * 60, gracePeriod: 30 * 24 * 60 * 60 },
} satisfies JwtOptions;
