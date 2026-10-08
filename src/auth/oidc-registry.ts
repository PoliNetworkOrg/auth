import { and, countDistinct, desc, eq, sql } from "drizzle-orm";
import { db } from "../db/index";
import { withAuthorizedRbacRead, withAuthorizedRbacWrite } from "./rbac-store";
import { RbacError } from "./rbac-store";
import { MASTER_ADMIN_ROLE_KEY } from "./rbac";
import { isServiceClient } from "./service-client-policy";
import { oauthClient, oauthClientResource, oauthConsent } from "../db/schema";
import {
  grantTypesForScopes,
  OIDC_CLIENT_REFERENCE,
  type OidcClientDraft,
  type OidcClientSummary,
} from "./oidc-clients";

type ClientRow = typeof oauthClient.$inferSelect;

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
    confidential: row.tokenEndpointAuthMethod !== "none",
    service: isServiceClient(row),
    authMethod: row.tokenEndpointAuthMethod ?? null,
    grantTypes: row.grantTypes ?? [],
    clientCredentialsScopes: row.clientCredentialsScopes ?? [],
    resourceIds,
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

export type OidcClientPatch = {
  draft?: OidcClientDraft;
  disabled?: boolean;
  skipConsent?: boolean;
};

/** Applies validated settings to a pooled client. Returns null when the client is not in the pool. */
export async function updateOidcClient(
  actorId: string,
  clientId: string,
  patch: OidcClientPatch,
): Promise<OidcClientSummary | null> {
  return withAuthorizedRbacWrite(
    actorId,
    "idp:applications:write",
    async (transaction, _catalog, access) => {
      await transaction.execute(sql`select set_config('polinetwork.actor_id', ${actorId}, true)`);
      const [existing] = await transaction
        .select({
          tokenEndpointAuthMethod: oauthClient.tokenEndpointAuthMethod,
          grantTypes: oauthClient.grantTypes,
          clientCredentialsScopes: oauthClient.clientCredentialsScopes,
          scopes: oauthClient.scopes,
        })
        .from(oauthClient)
        .where(
          and(
            eq(oauthClient.clientId, clientId),
            eq(oauthClient.referenceId, OIDC_CLIENT_REFERENCE),
          ),
        );
      if (existing && isServiceClient(existing) && !access.roles.includes(MASTER_ADMIN_ROLE_KEY))
        throw new RbacError(403, "Only Master Admin may change service clients.");
      const values: Partial<typeof oauthClient.$inferInsert> = { updatedAt: new Date() };
      if (patch.draft) {
        const draft = patch.draft;
        values.name = draft.name;
        values.uri = draft.uri || null;
        values.icon = draft.logo || null;
        values.redirectUris = draft.redirectUris;
        values.postLogoutRedirectUris = draft.postLogoutRedirectUris.length
          ? draft.postLogoutRedirectUris
          : null;
        values.contacts = draft.contacts.length ? draft.contacts : null;
        values.tos = draft.tosUri || null;
        values.policy = draft.policyUri || null;
        values.scopes = draft.scopes;
        values.grantTypes = grantTypesForScopes(draft.scopes);
        values.applicationType = draft.applicationType;
      }
      if (patch.disabled !== undefined) values.disabled = patch.disabled;
      if (patch.skipConsent !== undefined) values.skipConsent = patch.skipConsent;
      const [updated] = await transaction
        .update(oauthClient)
        .set(values)
        .where(
          and(
            eq(oauthClient.clientId, clientId),
            eq(oauthClient.referenceId, OIDC_CLIENT_REFERENCE),
          ),
        )
        .returning();
      if (!updated) return null;
      const [summary] = await readOidcClients(transaction, clientId);
      return summary ?? toSummary(updated, 0);
    },
  );
}
