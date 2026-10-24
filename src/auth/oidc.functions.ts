import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { ActionError } from "@/lib/action-error";
import { validate } from "@/lib/validate";
import { permissionMiddleware } from "./middleware";
import {
  apiAccessEnabled,
  checkClientDraft,
  createOidcClient,
  deleteOidcClient,
  listOidcClients,
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
  logoDark: z.string(),
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

/**
 * Registers a client in the shared pool and links it to the resources it asks for. Only
 * Master Admin may register one with API access.
 */
export const createOidcClientFn = createServerFn({ method: "POST" })
  .middleware([permissionMiddleware("idp:applications:write")])
  .validator(validate(z.object({ draft: draftSchema })))
  .handler(async ({ context, data }) => {
    const created = await createOidcClient(context.session.userId, checkClientDraft(data.draft));
    return { ...created, linked: true };
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
    const draft = data.draft ? checkClientDraft(data.draft) : undefined;
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
