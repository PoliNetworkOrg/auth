import { and, eq, isNull } from "drizzle-orm";
import { db } from "../db/index";
import { oauthClient, oauthClientResource } from "../db/schema";
import { env } from "../env";
import { MCP_PATH } from "./mcp-clients";

/** The MCP server's resource identifier: the URL agents connect to, and their tokens' audience. */
export const mcpResource = new URL(MCP_PATH, env.BETTER_AUTH_URL).href;

/** Where agents read which authorization server protects the MCP server (RFC 9728). */
export const mcpResourceMetadataUrl = new URL(
  `/.well-known/oauth-protected-resource${MCP_PATH}`,
  env.BETTER_AUTH_URL,
).href;

/** The OAuth issuer, as Better Auth names it from its base path. */
export const issuer = new URL("/api/auth", env.BETTER_AUTH_URL).href;

/**
 * Clients registered by agents through dynamic registration. Every other client belongs to
 * the shared pool (`OIDC_CLIENT_REFERENCE`); anonymous registration stores neither owner.
 */
export const isMcpClient = and(isNull(oauthClient.referenceId), isNull(oauthClient.userId));

/**
 * Finishes an agent's registration: links the client to the MCP server, the only resource
 * it may get tokens for, and drops what the registrant said about itself besides its name.
 * Logos, links and logout addresses would be shown or used as if PoliNetwork vouched for
 * them, and an agent needs none of them.
 */
export async function finishMcpRegistration(clientId: string) {
  await db.transaction(async (transaction) => {
    const [client] = await transaction
      .update(oauthClient)
      .set({
        uri: null,
        icon: null,
        iconDark: null,
        tos: null,
        policy: null,
        contacts: null,
        postLogoutRedirectUris: null,
        backchannelLogoutUri: null,
        backchannelLogoutSessionRequired: null,
        enableEndSession: false,
      })
      .where(and(eq(oauthClient.clientId, clientId), isMcpClient))
      .returning({ clientId: oauthClient.clientId });
    if (!client) return;
    await transaction
      .insert(oauthClientResource)
      .values({ id: crypto.randomUUID(), clientId, resourceId: mcpResource, createdAt: new Date() })
      .onConflictDoNothing();
  });
}

/** The scopes an agent's client may ask for, or null when the client is not an agent's. */
export async function mcpClientScopes(clientId: string) {
  const [client] = await db
    .select({ scopes: oauthClient.scopes })
    .from(oauthClient)
    .where(and(eq(oauthClient.clientId, clientId), isMcpClient));
  return client ? (client.scopes ?? []) : null;
}
