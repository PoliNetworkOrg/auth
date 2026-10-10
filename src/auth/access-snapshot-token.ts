import { createLocalJWKSet, jwtVerify, type JWK } from "jose";
import { auth } from "./index";
import { env } from "../env";

/** Verify the IdP's own resource-bound service token without trusting its claims before signature checks. */
export async function snapshotClientId(authorization: string | null): Promise<string | null> {
  const bearer = /^Bearer ([A-Za-z0-9._~-]+)$/.exec(authorization ?? "");
  const audience = env.OAUTH_INTERNAL_RESOURCE_URI;
  if (!bearer || !audience) return null;
  try {
    const jwks = await auth.api.getJwks();
    const { payload, protectedHeader } = await jwtVerify(
      bearer[1]!,
      createLocalJWKSet({ keys: jwks.keys as JWK[] }),
      {
        issuer: new URL("/api/auth", env.BETTER_AUTH_URL).href,
        audience,
        algorithms: ["EdDSA"],
        requiredClaims: ["sub", "iss", "aud", "iat", "exp"],
      },
    );
    if (
      protectedHeader.typ !== "at+jwt" ||
      payload.aud !== audience ||
      payload.pn_subject_type !== "client" ||
      typeof payload.client_id !== "string" ||
      payload.client_id !== payload.azp ||
      payload.client_id !== payload.sub ||
      typeof payload.scope !== "string" ||
      !payload.scope.split(" ").includes("idp:access:read") ||
      payload.cnf !== undefined
    )
      return null;
    return payload.client_id;
  } catch {
    return null;
  }
}
