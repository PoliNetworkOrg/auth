import { and, countDistinct, desc, eq } from "drizzle-orm";
import { db } from "../db/index";
import { oauthClient, oauthConsent } from "../db/schema";
import {
  grantTypesForScopes,
  OIDC_CLIENT_REFERENCE,
  type OidcClientDraft,
  type OidcClientSummary,
} from "./oidc-clients";

type ClientRow = typeof oauthClient.$inferSelect;

function toSummary(row: ClientRow, authorizedUsers: number): OidcClientSummary {
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
    applicationType: row.applicationType === "native" ? "native" : "web",
    disabled: row.disabled ?? false,
    skipConsent: row.skipConsent ?? false,
    createdAt: row.createdAt?.toISOString() ?? null,
    updatedAt: row.updatedAt?.toISOString() ?? null,
    authorizedUsers,
  };
}

/** Clients in the shared PoliNetwork pool, newest first, with how many people authorized each. */
export async function listOidcClients(clientId?: string): Promise<OidcClientSummary[]> {
  const filter = clientId
    ? and(eq(oauthClient.referenceId, OIDC_CLIENT_REFERENCE), eq(oauthClient.clientId, clientId))
    : eq(oauthClient.referenceId, OIDC_CLIENT_REFERENCE);
  const rows = await db
    .select()
    .from(oauthClient)
    .where(filter)
    .orderBy(desc(oauthClient.createdAt));
  const consents = await db
    .select({ clientId: oauthConsent.clientId, users: countDistinct(oauthConsent.userId) })
    .from(oauthConsent)
    .groupBy(oauthConsent.clientId);
  const usersByClient = new Map(consents.map((entry) => [entry.clientId, entry.users]));
  return rows.map((row) => toSummary(row, usersByClient.get(row.clientId) ?? 0));
}

export type OidcClientPatch = {
  draft?: OidcClientDraft;
  disabled?: boolean;
  skipConsent?: boolean;
};

/** Applies validated settings to a pooled client. Returns null when the client is not in the pool. */
export async function updateOidcClient(
  clientId: string,
  patch: OidcClientPatch,
): Promise<OidcClientSummary | null> {
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
  const [updated] = await db
    .update(oauthClient)
    .set(values)
    .where(
      and(eq(oauthClient.clientId, clientId), eq(oauthClient.referenceId, OIDC_CLIENT_REFERENCE)),
    )
    .returning();
  if (!updated) return null;
  const [summary] = await listOidcClients(clientId);
  return summary ?? toSummary(updated, 0);
}
