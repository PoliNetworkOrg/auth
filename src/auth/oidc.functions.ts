import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { ActionError } from "@/lib/action-error";
import { validate } from "@/lib/validate";
import { db } from "../db/index";
import { validateClientJwks } from "./client-jwks";
import { auth } from "./index";
import { permissionMiddleware } from "./middleware";
import { canAdministerIdp } from "./oidc-admin";
import {
  clientRegistration,
  hasDraftErrors,
  isRestrictedDraft,
  normalizeClientDraft,
  parsePublicJwks,
  validateClientDraft,
  type OidcClientDraft,
} from "./oidc-clients";
import {
  apiAccessEnabled,
  deleteOidcClient,
  linkNewOidcClient,
  listOidcClients,
  recheckNewOidcClientKeys,
  rotateOidcClientSecret,
  updateOidcClient,
} from "./oidc-registry";

/** What this deployment lets the application form offer. */
export const getOidcClientOptions = createServerFn({ method: "GET" })
  .middleware([permissionMiddleware("idp:applications:read", "idp:applications:write")])
  .handler(() => ({ apiAccess: apiAccessEnabled() }));

/** Every client in the shared PoliNetwork pool, newest first. */
export const getOidcClients = createServerFn({ method: "GET" })
  .middleware([permissionMiddleware("idp:applications:read")])
  .handler(({ context }) => listOidcClients(context.session.userId));

const clientIdSchema = z.object({ clientId: z.string().min(1) });

/** One pooled client; refused with 404 when it is not in the pool. */
export const getOidcClient = createServerFn({ method: "GET" })
  .middleware([permissionMiddleware("idp:applications:read")])
  .validator(validate(clientIdSchema))
  .handler(async ({ context, data }) => {
    const [client] = await listOidcClients(context.session.userId, data.clientId);
    if (!client) throw new ActionError(404, "Application not found.");
    return client;
  });

const draftSchema = z.object({
  name: z.string(),
  uri: z.string(),
  logo: z.string(),
  redirectUris: z.array(z.string()).max(50),
  postLogoutRedirectUris: z.array(z.string()).max(50),
  contacts: z.array(z.string()).max(20),
  tosUri: z.string(),
  policyUri: z.string(),
  applicationType: z.enum(["web", "native"]),
  credential: z.enum(["secret", "private-key", "public"]),
  jwks: z.string().max(20_000),
  signIn: z.boolean(),
  scopes: z.array(z.string()).max(10),
  serviceAccess: z.boolean(),
  apiScopes: z.array(z.string()).max(20),
  serviceScopes: z.array(z.string()).max(20),
  resources: z.array(z.enum(["backend", "internal"])).max(2),
  enableEndSession: z.boolean(),
});

/** Normalizes and checks a submitted draft with the rules the form uses. */
function checkedDraft(input: OidcClientDraft) {
  const draft = normalizeClientDraft(input);
  const fields = validateClientDraft(draft, { apiAccess: apiAccessEnabled() });
  // The item lists carry nulls for valid entries; the form reads them back as they are.
  if (hasDraftErrors(fields)) throw new ActionError(400, "Check the highlighted fields.", fields);
  return draft;
}

/**
 * Registers a client in the shared pool and links it to the resources it asks for. Only
 * Master Admin may register one with API access. A failed link still returns the new client
 * ID; saving the application again retries it.
 */
export const createOidcClientFn = createServerFn({ method: "POST" })
  .middleware([permissionMiddleware("idp:applications:write")])
  .validator(validate(z.object({ draft: draftSchema })))
  .handler(async ({ context, data }) => {
    const actorId = context.session.userId;
    const draft = checkedDraft(data.draft);
    if (isRestrictedDraft(draft) && !(await canAdministerIdp(actorId, db, true)))
      throw new ActionError(403, "Only Master Admin may register applications with API access.");
    const jwks = draft.credential === "private-key" ? parsePublicJwks(draft.jwks) : undefined;
    if (jwks) await validateClientJwks(jwks, db);

    const registration = clientRegistration(draft);
    let created: { client_id: string; client_secret?: string };
    try {
      created = await auth.api.adminCreateOAuthClient({
        headers: getRequest().headers,
        body: {
          client_name: draft.name,
          ...(draft.uri ? { client_uri: draft.uri } : {}),
          ...(draft.logo ? { logo_uri: draft.logo } : {}),
          ...(draft.tosUri ? { tos_uri: draft.tosUri } : {}),
          ...(draft.policyUri ? { policy_uri: draft.policyUri } : {}),
          ...(draft.contacts.length ? { contacts: draft.contacts } : {}),
          ...(registration.redirectUris.length
            ? { redirect_uris: registration.redirectUris, response_types: ["code" as const] }
            : {}),
          ...(registration.postLogoutRedirectUris.length
            ? { post_logout_redirect_uris: registration.postLogoutRedirectUris }
            : {}),
          scope: registration.scopes.join(" "),
          grant_types: registration.grantTypes,
          application_type: draft.applicationType,
          token_endpoint_auth_method:
            draft.credential === "public"
              ? "none"
              : draft.credential === "private-key"
                ? "private_key_jwt"
                : "client_secret_basic",
          ...(jwks ? { jwks } : {}),
          ...(registration.clientCredentialsScopes.length
            ? { client_credentials_scopes: registration.clientCredentialsScopes }
            : {}),
          ...(registration.enableEndSession ? { enable_end_session: true } : {}),
        },
      });
    } catch {
      throw new ActionError(
        400,
        "Unable to register this application. Check its redirect URIs and public key.",
      );
    }

    if (jwks && !(await recheckNewOidcClientKeys(actorId, created.client_id, jwks)))
      throw new ActionError(409, "This public key already belongs to another client.");
    let linked = true;
    try {
      await linkNewOidcClient(actorId, created.client_id, draft.resources);
    } catch {
      linked = false;
    }
    return {
      clientId: created.client_id,
      clientSecret: created.client_secret ?? null,
      linked,
    };
  });

/**
 * Changes a client's settings, switches it on or off, or skips its consent screen. A client
 * that starts using a secret gets its first one here, shown once like a rotated secret.
 */
export const updateOidcClientFn = createServerFn({ method: "POST" })
  .middleware([permissionMiddleware("idp:applications:write")])
  .validator(
    validate(
      z.object({
        clientId: z.string().min(1),
        draft: draftSchema.optional(),
        disabled: z.boolean().optional(),
        skipConsent: z.boolean().optional(),
      }),
    ),
  )
  .handler(async ({ context, data }) => {
    const { clientId, disabled, skipConsent } = data;
    const draft = data.draft ? checkedDraft(data.draft) : undefined;
    const result = await updateOidcClient(context.session.userId, clientId, {
      draft,
      disabled,
      skipConsent,
    });
    if (!result) throw new ActionError(404, "Application not found.");
    return result;
  });

/** Replaces a client's secret. The new secret is returned once and never stored in clear. */
export const rotateOidcClientSecretFn = createServerFn({ method: "POST" })
  .middleware([permissionMiddleware("idp:applications:write")])
  .validator(validate(clientIdSchema))
  .handler(async ({ context, data }) => {
    const result = await rotateOidcClientSecret(context.session.userId, data.clientId);
    if (!result) throw new ActionError(404, "Application not found.");
    return result;
  });

/** Deletes a client with its refresh tokens, consents and resource links. */
export const deleteOidcClientFn = createServerFn({ method: "POST" })
  .middleware([permissionMiddleware("idp:applications:write")])
  .validator(validate(clientIdSchema))
  .handler(async ({ context, data }) => {
    if (!(await deleteOidcClient(context.session.userId, data.clientId)))
      throw new ActionError(404, "Application not found.");
  });
