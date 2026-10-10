import { and, countDistinct, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db/index";
import { oauthClient, oauthClientResource, oauthConsent } from "../db/schema";
import { env } from "../env";
import { validateClientJwks } from "./client-jwks";
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

export type OidcClientPatch = {
  draft?: OidcClientDraft;
  disabled?: boolean;
  skipConsent?: boolean;
};

/**
 * Stands in for a secret until the token endpoint's own rotation replaces it. No presented
 * secret hashes to a value with a colon, so nothing authenticates with it meanwhile.
 */
function unusableSecret() {
  return `pending:${crypto.randomUUID()}`;
}

/**
 * Applies validated settings to a pooled client. Returns null when the client is not in the
 * pool. `issueSecret` asks the caller to issue the first secret of a client that now uses
 * one, through the provider's rotation endpoint.
 */
export async function updateOidcClient(
  actorId: string,
  clientId: string,
  patch: OidcClientPatch,
): Promise<{ client: OidcClientSummary; issueSecret: boolean } | null> {
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
      const values: Partial<typeof oauthClient.$inferInsert> = { updatedAt: new Date() };
      let issueSecret = false;
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
            values.tokenEndpointAuthMethod = "client_secret_basic";
            values.clientSecret = unusableSecret();
            issueSecret = true;
          }
        }
        if (masterAdmin) await syncResourceLinks(transaction, clientId, draft.resources);
      }
      if (patch.disabled !== undefined) values.disabled = patch.disabled;
      if (patch.skipConsent !== undefined) values.skipConsent = patch.skipConsent;
      await transaction
        .update(oauthClient)
        .set(values)
        .where(
          and(
            eq(oauthClient.clientId, clientId),
            eq(oauthClient.referenceId, OIDC_CLIENT_REFERENCE),
          ),
        );
      const [summary] = await readOidcClients(transaction, clientId);
      return { client: summary!, issueSecret };
    },
  );
}
