import { and, desc, eq } from "drizzle-orm";
import { createLocalJWKSet, jwtVerify, type JWK } from "jose";
import { db } from "../db/index";
import { oauthClient, oauthConsent } from "../db/schema";
import { auth } from "./index";
import { MCP_SCOPE } from "./mcp-clients";
import { isMcpClient, issuer, mcpResource } from "./mcp-resource";

const USE_RECORD_INTERVAL_MS = 60 * 60 * 1000;

export type McpCaller = {
  token: string;
  userId: string;
  clientId: string;
  scopes: string[];
  /** Seconds since the epoch. */
  expiresAt: number;
};

/**
 * The person and agent behind an MCP request, or null. The token is checked against this
 * identity provider's own keys before any claim is trusted. It must be addressed to the MCP
 * server, carry `idp:mcp`, and come from an agent's client that the person still has a
 * consent for: disconnecting an agent deletes the consent, so its access ends at once rather
 * than when the token expires. Whether the person may use the server is decided by the caller.
 */
export async function verifyMcpToken(authorization: string | null): Promise<McpCaller | null> {
  const bearer = /^Bearer ([A-Za-z0-9._~-]+)$/i.exec(authorization ?? "");
  if (!bearer) return null;
  const token = bearer[1]!;
  let caller: McpCaller;
  try {
    const jwks = await auth.api.getJwks();
    const { payload, protectedHeader } = await jwtVerify(
      token,
      createLocalJWKSet({ keys: jwks.keys as JWK[] }),
      {
        issuer,
        audience: mcpResource,
        algorithms: ["EdDSA"],
        requiredClaims: ["sub", "iss", "aud", "iat", "exp"],
      },
    );
    const scopes = typeof payload.scope === "string" ? payload.scope.split(" ") : [];
    if (
      protectedHeader.typ !== "at+jwt" ||
      payload.pn_subject_type !== "user" ||
      typeof payload.sub !== "string" ||
      typeof payload.azp !== "string" ||
      payload.client_id !== payload.azp ||
      !scopes.includes(MCP_SCOPE) ||
      // A sender-constrained token needs a DPoP proof this server does not check.
      payload.cnf !== undefined
    )
      return null;
    caller = {
      token,
      userId: payload.sub,
      clientId: payload.azp,
      scopes,
      expiresAt: payload.exp!,
    };
  } catch {
    return null;
  }
  const [connection] = await db
    .select({
      disabled: oauthClient.disabled,
      consentId: oauthConsent.id,
      usedAt: oauthConsent.updatedAt,
    })
    .from(oauthClient)
    .innerJoin(
      oauthConsent,
      and(eq(oauthConsent.clientId, oauthClient.clientId), eq(oauthConsent.userId, caller.userId)),
    )
    .where(and(eq(oauthClient.clientId, caller.clientId), isMcpClient))
    .orderBy(desc(oauthConsent.updatedAt))
    .limit(1);
  if (!connection || connection.disabled) return null;
  // Better Auth only writes a consent's updatedAt. For an agent it also records when the agent
  // last used the server, at most hourly: the account page shows it and pruning relies on it.
  if (connection.usedAt.getTime() < Date.now() - USE_RECORD_INTERVAL_MS)
    await db
      .update(oauthConsent)
      .set({ updatedAt: new Date() })
      .where(eq(oauthConsent.id, connection.consentId));
  return caller;
}
