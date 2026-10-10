import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { ActionError } from "@/lib/action-error";
import { validate } from "@/lib/validate";
import { db } from "../db/index";
import { oauthClient } from "../db/schema";
import { env } from "../env";
import { auth } from "./index";
import { permissionMiddleware } from "./middleware";
import { canAdministerIdp } from "./oidc-admin";
import {
  hasDraftErrors,
  normalizeClientDraft,
  OIDC_CLIENT_REFERENCE,
  validateClientDraft,
} from "./oidc-clients";
import { listOidcClients, updateOidcClient } from "./oidc-registry";
import { MASTER_ADMIN_ROLE_KEY } from "./rbac";
import { RbacError, withAuthorizedRbacWrite } from "./rbac-store";
import { isServiceClient } from "./service-client-policy";
import { SERVICE_CLIENT_TEMPLATES } from "./service-client-templates";
import { ServiceJwksError, validateServiceJwks } from "./service-jwks";

/** Every client in the shared PoliNetwork pool, newest first. */
export const getOidcClients = createServerFn({ method: "GET" })
  .middleware([permissionMiddleware("idp:applications:read")])
  .handler(({ context }) => listOidcClients(context.session.userId));

/** One pooled client; refused with 404 when it is not in the pool. */
export const getOidcClient = createServerFn({ method: "GET" })
  .middleware([permissionMiddleware("idp:applications:read")])
  .validator(validate(z.object({ clientId: z.string().min(1) })))
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
  scopes: z.array(z.string()).max(10),
  applicationType: z.enum(["web", "native"]),
});

/** Changes a client's settings, or switches it on or off, or its consent screen. */
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
    let draft;
    if (data.draft) {
      draft = normalizeClientDraft(data.draft);
      const fields = validateClientDraft(draft);
      // The item lists carry nulls for valid entries; the form reads them back as they are.
      if (hasDraftErrors(fields))
        throw new ActionError(400, "Check the highlighted fields.", fields);
    }
    const client = await updateOidcClient(context.session.userId, clientId, {
      draft,
      disabled,
      skipConsent,
    });
    if (!client) throw new ActionError(404, "Application not found.");
    return client;
  });

function resourceIdentifier(resource: "backend" | "internal") {
  const identifier =
    resource === "backend" ? env.OAUTH_BACKEND_RESOURCE_URI : env.OAUTH_INTERNAL_RESOURCE_URI;
  if (!identifier) throw new ActionError(503, "OAuth resources are not configured.");
  return identifier;
}

/** Links a pooled client to the configured backend or internal resource. Master Admin only. */
export const linkOidcResourceFn = createServerFn({ method: "POST" })
  .middleware([permissionMiddleware("idp:applications:write")])
  .validator(
    validate(z.object({ clientId: z.string().min(1), resource: z.enum(["backend", "internal"]) })),
  )
  .handler(async ({ context, data }) => {
    if (!(await canAdministerIdp(context.session.userId, db, true)))
      throw new ActionError(403, "Only Master Admin may link service resources.");
    const identifier = resourceIdentifier(data.resource);
    const [client] = await db
      .select({ id: oauthClient.id })
      .from(oauthClient)
      .where(
        and(
          eq(oauthClient.clientId, data.clientId),
          eq(oauthClient.referenceId, OIDC_CLIENT_REFERENCE),
        ),
      );
    if (!client) throw new ActionError(404, "Application not found.");
    try {
      await auth.api.adminLinkClientResource({
        headers: getRequest().headers,
        params: { identifier, client_id: data.clientId },
      });
    } catch {
      throw new ActionError(502, "Unable to link the configured resource.");
    }
    return { linked: true };
  });

const publicJwksSchema = z.object({
  keys: z.array(z.record(z.string(), z.unknown())).min(1).max(5),
});

async function checkServiceJwks(...args: Parameters<typeof validateServiceJwks>) {
  try {
    await validateServiceJwks(...args);
  } catch (error) {
    if (error instanceof ServiceJwksError) throw new ActionError(error.status, error.message);
    throw error;
  }
}

/**
 * Registers a service client from a template and links it to its resource. Master Admin
 * only. A failed link still returns the new client ID, so the link can be retried.
 */
export const registerServiceClientFn = createServerFn({ method: "POST" })
  .middleware([permissionMiddleware("idp:applications:write")])
  .validator(
    validate(
      z.object({
        kind: z.enum(["telegram-bot", "website", "admin-dashboard", "backend"]),
        jwks: publicJwksSchema,
        redirectUri: z.url().optional(),
      }),
    ),
  )
  .handler(async ({ context, data }) => {
    if (!(await canAdministerIdp(context.session.userId, db, true)))
      throw new ActionError(403, "Only Master Admin may register service clients.");
    const { kind, jwks, redirectUri } = data;
    const template = SERVICE_CLIENT_TEMPLATES[kind];
    const resource = resourceIdentifier(template.resource);
    if (template.interactive && !redirectUri)
      throw new ActionError(400, "The dashboard redirect URI is required.");
    await checkServiceJwks(jwks, db);

    const headers = getRequest().headers;
    let clientId: string;
    try {
      const created = await auth.api.adminCreateOAuthClient({
        headers,
        body: {
          client_name: template.name,
          token_endpoint_auth_method: "private_key_jwt",
          jwks,
          grant_types: template.interactive
            ? ["authorization_code", "refresh_token"]
            : ["client_credentials"],
          scope: template.scopes.join(" "),
          subject_type: "public",
          ...(template.interactive
            ? {
                redirect_uris: [redirectUri!],
                response_types: ["code" as const],
                enable_end_session: true,
                require_pkce: true,
              }
            : { client_credentials_scopes: [...template.scopes] }),
        },
      });
      clientId = created.client_id;
    } catch {
      throw new ActionError(
        400,
        "Unable to register this service client. Check its public key and redirect URI.",
      );
    }

    let linked = false;
    try {
      const result = await auth.api.adminLinkClientResource({
        headers,
        params: { identifier: resource, client_id: clientId },
      });
      linked = result.linked;
    } catch {
      // Return the new client ID so the administrator can retry the resource link.
    }
    return { clientId, linked };
  });

/** Replaces a service client's public JWKS. Master Admin only. */
export const saveServiceJwksFn = createServerFn({ method: "POST" })
  .middleware([permissionMiddleware("idp:applications:write")])
  .validator(validate(z.object({ clientId: z.string().min(1), jwks: publicJwksSchema })))
  .handler(async ({ context, data }) => {
    const actorId = context.session.userId;
    try {
      return await withAuthorizedRbacWrite(
        actorId,
        "idp:applications:write",
        async (transaction, _catalog, access) => {
          if (!access.roles.includes(MASTER_ADMIN_ROLE_KEY))
            throw new RbacError(403, "Only Master Admin may rotate service keys.");
          const [client] = await transaction
            .select({
              id: oauthClient.id,
              tokenEndpointAuthMethod: oauthClient.tokenEndpointAuthMethod,
              clientCredentialsScopes: oauthClient.clientCredentialsScopes,
              scopes: oauthClient.scopes,
            })
            .from(oauthClient)
            .where(
              and(
                eq(oauthClient.clientId, data.clientId),
                eq(oauthClient.referenceId, OIDC_CLIENT_REFERENCE),
              ),
            );
          if (!client || !isServiceClient(client))
            throw new RbacError(404, "Service client not found.");
          await validateServiceJwks(data.jwks, transaction, data.clientId);
          await transaction.execute(
            sql`select set_config('polinetwork.actor_id', ${actorId}, true)`,
          );
          const jwks = JSON.stringify(data.jwks);
          await transaction
            .update(oauthClient)
            .set({ jwks, updatedAt: new Date() })
            .where(eq(oauthClient.id, client.id));
          return { jwks };
        },
      );
    } catch (error) {
      if (error instanceof ServiceJwksError) throw new ActionError(error.status, error.message);
      throw error;
    }
  });
