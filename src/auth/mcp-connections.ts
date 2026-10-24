import { and, count, desc, eq, gt, lt, notExists, sql } from "drizzle-orm";
import { db } from "../db/index";
import { oauthAccessToken, oauthClient, oauthConsent, oauthRefreshToken } from "../db/schema";
import { isMcpClient } from "./mcp-resource";

export type McpConnection = {
  clientId: string;
  name: string | null;
  /** Where the agent receives its sign-in, such as `127.0.0.1:53682` or `claude.ai`. */
  redirectHost: string | null;
  connectedAt: Date;
  /** When the agent last used the server, to the hour; see `verifyMcpToken`. */
  lastUsedAt: Date;
};

function hostOf(uri: string | undefined) {
  try {
    return uri ? new URL(uri).host : null;
  } catch {
    return null;
  }
}

/** The agents someone has connected to the MCP server, newest first. */
export async function listMcpConnections(userId: string): Promise<McpConnection[]> {
  const rows = await db
    .select({
      clientId: oauthClient.clientId,
      name: oauthClient.name,
      redirectUris: oauthClient.redirectUris,
      connectedAt: oauthConsent.createdAt,
      lastUsedAt: oauthConsent.updatedAt,
    })
    .from(oauthConsent)
    .innerJoin(oauthClient, eq(oauthClient.clientId, oauthConsent.clientId))
    .where(and(eq(oauthConsent.userId, userId), isMcpClient))
    .orderBy(desc(oauthConsent.createdAt));
  return rows.map(({ redirectUris, ...row }) => ({
    ...row,
    redirectHost: hostOf(redirectUris[0]),
  }));
}

/**
 * Ends one agent's access for this person: their consent and tokens go, which the MCP server
 * notices on the next request. An agent's client is its own registration, so it is deleted
 * once nobody uses it. Returns false when the agent is not one of theirs.
 */
export async function disconnectMcpConnection(userId: string, clientId: string) {
  return db.transaction(async (transaction) => {
    await transaction.execute(sql`select set_config('polinetwork.actor_id', ${userId}, true)`);
    const removed = await transaction
      .delete(oauthConsent)
      .where(
        and(
          eq(oauthConsent.userId, userId),
          eq(oauthConsent.clientId, clientId),
          sql`exists (select 1 from ${oauthClient} where ${oauthClient.clientId} = ${clientId} and ${isMcpClient})`,
        ),
      )
      .returning({ id: oauthConsent.id });
    if (!removed.length) return false;
    await transaction
      .delete(oauthRefreshToken)
      .where(and(eq(oauthRefreshToken.userId, userId), eq(oauthRefreshToken.clientId, clientId)));
    await transaction
      .delete(oauthAccessToken)
      .where(and(eq(oauthAccessToken.userId, userId), eq(oauthAccessToken.clientId, clientId)));
    const [{ remaining }] = await transaction
      .select({ remaining: count() })
      .from(oauthConsent)
      .where(eq(oauthConsent.clientId, clientId));
    if (!remaining)
      await transaction
        .delete(oauthClient)
        .where(and(eq(oauthClient.clientId, clientId), isMcpClient));
    return true;
  });
}

/** Agents get a day to finish signing in before an unused registration is removed. */
const UNUSED_REGISTRATION_MS = 24 * 60 * 60 * 1000;

/**
 * An agent unused this long must sign in again anyway: its refresh token lasts 30 days, and
 * every use of the server is recorded on its consent.
 */
const IDLE_CONNECTION_MS = 60 * 24 * 60 * 60 * 1000;

/**
 * Deletes agent registrations nobody uses: those never approved within a day, and those
 * nobody has used for 60 days. Anyone can register an agent, so this keeps their number
 * bounded. Deleting a client also deletes its consents and tokens.
 */
export async function pruneMcpClients() {
  const now = Date.now();
  await db.delete(oauthClient).where(
    and(
      isMcpClient,
      lt(oauthClient.createdAt, new Date(now - UNUSED_REGISTRATION_MS)),
      notExists(
        db
          .select({ one: sql`1` })
          .from(oauthConsent)
          .where(
            and(
              eq(oauthConsent.clientId, oauthClient.clientId),
              gt(oauthConsent.updatedAt, new Date(now - IDLE_CONNECTION_MS)),
            ),
          ),
      ),
    ),
  );
}
