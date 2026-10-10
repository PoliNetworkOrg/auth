import { and, countDistinct, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db/index";
import { oauthClient, oauthClientResource, oauthConsent } from "../db/schema";
import { env } from "../env";
import { ClientJwksError, validateClientJwks } from "./client-jwks";
import { issueClientSecret } from "./client-secret";
import { MASTER_ADMIN_ROLE_KEY } from "./rbac";
import { RbacError, withAuthorizedRbacRead, withAuthorizedRbacWrite } from "./rbac-store";
import {
  clientRegistration,
  credentialOf,
  isRestrictedClient,
  isRestrictedDraft,
  OIDC_CLIENT_REFERENCE,
  parsePublicJwks,
  type OidcClientDraft,
  type OidcClientSummary,
  type OidcResourceKey,
  type PublicJwks,
} from "./oidc-clients";

type ClientRow = typeof oauthClient.$inferSelect;

/** The resource identifiers this deployment configures, by key. */
export function configuredResources(): Partial<Record<OidcResourceKey, string>> {
  return {
    ...(env.OAUTH_BACKEND_RESOURCE_URI ? { backend: env.OAUTH_BACKEND_RESOURCE_URI } : {}),
    ...(env.OAUTH_INTERNAL_RESOURCE_URI ? { internal: env.OAUTH_INTERNAL_RESOURCE_URI } : {}),
  };
}

/** Service OAuth runs only with both resources configured; see `src/auth/index.ts`. */
export function apiAccessEnabled() {
  return Boolean(env.OAUTH_BACKEND_RESOURCE_URI && env.OAUTH_INTERNAL_RESOURCE_URI);
}

function resourceKeys(resourceIds: string[]): OidcResourceKey[] {
  const configured = configuredResources();
  return (Object.keys(configured) as OidcResourceKey[]).filter((key) =>
    resourceIds.includes(configured[key]!),
  );
}

function toSummary(
  row: ClientRow,
  authorizedUsers: number,
  resourceIds: string[] = [],
): OidcClientSummary {
  return {
    clientId: row.clientId,
    name: row.name ?? "Untitled application",
    uri: row.uri ?? null,
    logo: row.icon ?? null,
    redirectUris: row.redirectUris,
    postLogoutRedirectUris: row.postLogoutRedirectUris ?? [],
    contacts: row.contacts ?? [],
    tosUri: row.tos ?? null,
    policyUri: row.policy ?? null,
    scopes: row.scopes ?? [],
    credential: credentialOf(row.tokenEndpointAuthMethod),
    restricted: isRestrictedClient({ ...row, resourceIds }),
    authMethod: row.tokenEndpointAuthMethod ?? null,
    grantTypes: row.grantTypes ?? [],
    clientCredentialsScopes: row.clientCredentialsScopes ?? [],
    resourceIds,
    resources: resourceKeys(resourceIds),
    enableEndSession: row.enableEndSession ?? false,
    jwks: row.jwks ?? null,
    applicationType: row.applicationType === "native" ? "native" : "web",
    disabled: row.disabled ?? false,
    skipConsent: row.skipConsent ?? false,
    createdAt: row.createdAt?.toISOString() ?? null,
    updatedAt: row.updatedAt?.toISOString() ?? null,
    authorizedUsers,
  };
}

/** Clients in the shared PoliNetwork pool, newest first, with how many people authorized each. */
async function readOidcClients(
  reader: Pick<typeof db, "select">,
  clientId?: string,
): Promise<OidcClientSummary[]> {
  const filter = clientId
    ? and(eq(oauthClient.referenceId, OIDC_CLIENT_REFERENCE), eq(oauthClient.clientId, clientId))
    : eq(oauthClient.referenceId, OIDC_CLIENT_REFERENCE);
  const rows = await reader
    .select()
    .from(oauthClient)
    .where(filter)
    .orderBy(desc(oauthClient.createdAt));
  const consents = await reader
    .select({ clientId: oauthConsent.clientId, users: countDistinct(oauthConsent.userId) })
    .from(oauthConsent)
    .groupBy(oauthConsent.clientId);
  const usersByClient = new Map(consents.map((entry) => [entry.clientId, entry.users]));
  const links = await reader
    .select({ clientId: oauthClientResource.clientId, resourceId: oauthClientResource.resourceId })
    .from(oauthClientResource);
  const resourcesByClient = new Map<string, string[]>();
  for (const link of links) {
    const resources = resourcesByClient.get(link.clientId) ?? [];
    resources.push(link.resourceId);
    resourcesByClient.set(link.clientId, resources);
  }
  return rows.map((row) =>
    toSummary(
      row,
      usersByClient.get(row.clientId) ?? 0,
      resourcesByClient.get(row.clientId)?.sort() ?? [],
    ),
  );
}

export async function listOidcClients(
  actorId: string,
  clientId?: string,
): Promise<OidcClientSummary[]> {
  return withAuthorizedRbacRead(actorId, ["idp:applications:read"], (transaction) =>
    readOidcClients(transaction, clientId),
  );
}

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

const pooledClient = (clientId: string) =>
  and(eq(oauthClient.clientId, clientId), eq(oauthClient.referenceId, OIDC_CLIENT_REFERENCE));

/**
 * Makes the client's links to the configured resources match `resources`. Links to
 * identifiers this deployment does not configure are left alone.
 */
async function syncResourceLinks(
  transaction: Transaction,
  clientId: string,
  resources: OidcResourceKey[],
) {
  const configured = configuredResources();
  const managed = Object.values(configured);
  if (!managed.length) return;
  const wanted = resources.flatMap((key) => (configured[key] ? [configured[key]] : []));
  const existing = (
    await transaction
      .select({ resourceId: oauthClientResource.resourceId })
      .from(oauthClientResource)
      .where(eq(oauthClientResource.clientId, clientId))
  ).map((link) => link.resourceId);
  const stale = existing.filter((id) => managed.includes(id) && !wanted.includes(id));
  if (stale.length)
    await transaction
      .delete(oauthClientResource)
      .where(
        and(
          eq(oauthClientResource.clientId, clientId),
          inArray(oauthClientResource.resourceId, stale),
        ),
      );
  const missing = wanted.filter((id) => !existing.includes(id));
  if (missing.length)
    await transaction.insert(oauthClientResource).values(
      missing.map((resourceId) => ({
        id: crypto.randomUUID(),
        clientId,
        resourceId,
        createdAt: new Date(),
      })),
    );
}

/**
 * Links a newly created client to the resources its draft asks for. Master Admin only,
 * like every resource link.
 */
export async function linkNewOidcClient(
  actorId: string,
  clientId: string,
  resources: OidcResourceKey[],
) {
  if (!resources.length) return;
  await withAuthorizedRbacWrite(
    actorId,
    "idp:applications:write",
    async (transaction, _catalog, access) => {
      if (!access.roles.includes(MASTER_ADMIN_ROLE_KEY))
        throw new RbacError(403, "Only Master Admin may link API resources.");
      await transaction.execute(sql`select set_config('polinetwork.actor_id', ${actorId}, true)`);
      await syncResourceLinks(transaction, clientId, resources);
    },
  );
}

/**
 * Rechecks a newly created client's public keys against every other client, under the RBAC
 * write lock. The provider inserts the client outside that lock, so a key checked before the
 * insert may have been given to another client in the meantime. Deletes the new client and
 * returns false when its key now belongs to another one.
 */
export async function recheckNewOidcClientKeys(
  actorId: string,
  clientId: string,
  jwks: PublicJwks,
) {
  return withAuthorizedRbacWrite(actorId, "idp:applications:write", async (transaction) => {
    await transaction.execute(sql`select set_config('polinetwork.actor_id', ${actorId}, true)`);
    try {
      await validateClientJwks(jwks, transaction, clientId);
      return true;
    } catch (error) {
      if (!(error instanceof ClientJwksError)) throw error;
      await transaction.delete(oauthClient).where(pooledClient(clientId));
      return false;
    }
  });
}

export type OidcClientPatch = {
  draft?: OidcClientDraft;
  disabled?: boolean;
  skipConsent?: boolean;
};

/**
 * Runs `change` on a pooled client as `actorId`, under the RBAC write lock that promotion to
 * API access also takes. The client is read and its restriction checked inside the same
 * transaction, so a change either lands before a concurrent promotion or sees the promoted
 * client and is refused. Returns null when the client is not in the pool.
 */
async function changePooledClient<T>(
  actorId: string,
  clientId: string,
  change: (
    transaction: Transaction,
    existing: OidcClientSummary,
    masterAdmin: boolean,
  ) => Promise<T>,
): Promise<T | null> {
  return withAuthorizedRbacWrite(
    actorId,
    "idp:applications:write",
    async (transaction, _catalog, access) => {
      await transaction.execute(sql`select set_config('polinetwork.actor_id', ${actorId}, true)`);
      const [existing] = await readOidcClients(transaction, clientId);
      if (!existing) return null;
      const masterAdmin = access.roles.includes(MASTER_ADMIN_ROLE_KEY);
      if (existing.restricted && !masterAdmin)
        throw new RbacError(403, "Only Master Admin may change applications with API access.");
      return change(transaction, existing, masterAdmin);
    },
  );
}

/**
 * Applies validated settings to a pooled client. Returns null when the client is not in the
 * pool. `clientSecret` is the first secret of a client that now uses one, shown once.
 */
export async function updateOidcClient(
  actorId: string,
  clientId: string,
  patch: OidcClientPatch,
): Promise<{ client: OidcClientSummary; clientSecret: string | null } | null> {
  return changePooledClient(actorId, clientId, async (transaction, existing, masterAdmin) => {
    const values: Partial<typeof oauthClient.$inferInsert> = { updatedAt: new Date() };
    let clientSecret: string | null = null;
    if (patch.draft) {
      const draft = patch.draft;
      if (isRestrictedDraft(draft) && !masterAdmin)
        throw new RbacError(403, "Only Master Admin may give an application API access.");
      const registration = clientRegistration(draft);
      values.name = draft.name;
      values.uri = draft.uri || null;
      values.icon = draft.logo || null;
      values.redirectUris = registration.redirectUris;
      values.postLogoutRedirectUris = registration.postLogoutRedirectUris.length
        ? registration.postLogoutRedirectUris
        : null;
      values.contacts = draft.contacts.length ? draft.contacts : null;
      values.tos = draft.tosUri || null;
      values.policy = draft.policyUri || null;
      values.scopes = registration.scopes;
      values.grantTypes = registration.grantTypes;
      values.responseTypes = draft.signIn ? ["code"] : null;
      values.clientCredentialsScopes = registration.clientCredentialsScopes;
      values.enableEndSession = registration.enableEndSession;
      values.applicationType = draft.applicationType;
      if (draft.credential === "private-key") {
        const jwks = parsePublicJwks(draft.jwks);
        await validateClientJwks(jwks, transaction, clientId);
        values.tokenEndpointAuthMethod = "private_key_jwt";
        values.jwks = JSON.stringify(jwks);
        values.jwksUri = null;
        values.clientSecret = null;
      } else {
        values.jwks = null;
        values.jwksUri = null;
        if (draft.credential === "public") {
          values.tokenEndpointAuthMethod = "none";
          values.clientSecret = null;
        } else if (existing.credential !== "secret") {
          const issued = issueClientSecret();
          values.tokenEndpointAuthMethod = "client_secret_basic";
          values.clientSecret = issued.stored;
          clientSecret = issued.secret;
        }
      }
      if (masterAdmin) await syncResourceLinks(transaction, clientId, draft.resources);
    }
    if (patch.disabled !== undefined) values.disabled = patch.disabled;
    if (patch.skipConsent !== undefined) values.skipConsent = patch.skipConsent;
    await transaction.update(oauthClient).set(values).where(pooledClient(clientId));
    const [summary] = await readOidcClients(transaction, clientId);
    return { client: summary!, clientSecret };
  });
}

/**
 * Replaces a pooled client's secret and returns the new one, shown once. Returns null when
 * the client is not in the pool.
 */
export async function rotateOidcClientSecret(
  actorId: string,
  clientId: string,
): Promise<{ clientSecret: string } | null> {
  return changePooledClient(actorId, clientId, async (transaction, existing) => {
    if (existing.credential !== "secret")
      throw new RbacError(400, "Only an application that uses a client secret has one to rotate.");
    const issued = issueClientSecret();
    await transaction
      .update(oauthClient)
      .set({ clientSecret: issued.stored, updatedAt: new Date() })
      .where(pooledClient(clientId));
    return { clientSecret: issued.secret };
  });
}

/**
 * Deletes a pooled client; its stored tokens, consents and resource links go with it.
 * Returns null when the client is not in the pool.
 */
export async function deleteOidcClient(actorId: string, clientId: string) {
  return changePooledClient(actorId, clientId, async (transaction) => {
    await transaction.delete(oauthClient).where(pooledClient(clientId));
    return true;
  });
}
