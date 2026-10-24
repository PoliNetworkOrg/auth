import { getOAuthProviderState, oauthProvider } from "@better-auth/oauth-provider";
import { getAuthenticatorName, passkey } from "@better-auth/passkey";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { betterAuth, type User } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { genericOAuth } from "better-auth/plugins/generic-oauth";
import { jwt } from "better-auth/plugins/jwt";
import { parseCookies } from "better-auth/cookies";
import { tanstackStartCookies } from "better-auth/tanstack-start";
import { db } from "../db";
import * as schema from "../db/schema";
import { env } from "../env";
import { AUTH_COOKIE_PREFIX, PASSKEY_UNSUPPORTED_COOKIE } from "./cookies";
import { appEmail } from "./contact-email";
import { startAccessDispatcher } from "./access-dispatcher";
import { startDataRetention } from "./data-retention";
import { getOidcClaims } from "./identity";
import {
  PASSKEY_PROMPT_PAGE,
  SESSION_FRESH_AGE,
  readPasskeyPromptState,
  shouldOfferPasskey,
} from "./passkey-prompt";
import { ensureIdTokenKey, jwtOptions } from "./jwt-options";
import { startKeyPruning } from "./key-pruning";
import { logAuthorizationDenial } from "./denial-log";
import { MCP_CLIENT_SCOPES, MCP_SCOPE, checkMcpRegistration } from "./mcp-clients";
import { finishMcpRegistration, mcpAuthorizationRequest, mcpResource } from "./mcp-resource";
import { hasIdpPermission } from "./idp-access";
import { canAdministerIdp } from "./oidc-admin";
import { validateClientJwks } from "./client-jwks";
import { rawClientMutationPaths, refusedClientMutationPaths } from "./client-endpoints";
import { apiScopes, isApiScope, OIDC_CLIENT_REFERENCE, parsePublicJwks } from "./oidc-clients";
import { isLinkOnlyProvider, standardIdTokenClaims } from "./policy";
import { providers } from "./providers";
import { clientIpOptions, oauthRateLimit, postgresRateLimitStorage } from "./rate-limit";
import {
  passkeyLabel,
  passkeyListSchema,
  passkeyUsername,
  registrationOptionsSchema,
} from "./passkeys";

const registeredClientSchema = z.object({ client_id: z.string().min(1) });

/** Token lifetimes in seconds. The MCP server reports them to agents debugging a client. */
export const tokenLifetimes = {
  accessToken: 300,
  clientCredentialsAccessToken: 3600,
  idToken: 300,
  refreshToken: 30 * 24 * 60 * 60,
};

const backendScopes = [
  "openid",
  "profile",
  "email",
  "offline_access",
  ...apiScopes.filter((scope) => scope.resource === "backend").map((scope) => scope.id),
];
const serviceOAuthEnabled = Boolean(
  env.OAUTH_BACKEND_RESOURCE_URI && env.OAUTH_INTERNAL_RESOURCE_URI,
);
// Agents connected to the MCP server get short-lived tokens addressed to it alone.
const mcpResourcePolicy = {
  identifier: mcpResource,
  accessTokenTtl: tokenLifetimes.accessToken,
  allowedScopes: MCP_CLIENT_SCOPES,
  signingAlgorithm: "EdDSA" as const,
};
const serviceResources =
  env.OAUTH_BACKEND_RESOURCE_URI && env.OAUTH_INTERNAL_RESOURCE_URI
    ? [
        {
          identifier: env.OAUTH_BACKEND_RESOURCE_URI,
          accessTokenTtl: 3600,
          refreshTokenTtl: 604800,
          allowedScopes: backendScopes,
          signingAlgorithm: "EdDSA" as const,
        },
        {
          identifier: env.OAUTH_INTERNAL_RESOURCE_URI,
          accessTokenTtl: 300,
          allowedScopes: ["idp:access:read"],
          signingAlgorithm: "EdDSA" as const,
        },
      ]
    : [];

/** The user as apps see them, with the address from `appEmail` when the `email` scope asks. */
async function withAppEmail(user: User, scopes: string[]) {
  return scopes.includes("email") ? { ...user, ...(await appEmail(db, user)) } : user;
}

export const auth = betterAuth({
  appName: "PoliNetwork Auth",
  baseURL: env.BETTER_AUTH_URL,
  secret: env.BETTER_AUTH_SECRET,
  database: drizzleAdapter(db, { provider: "pg", schema }),
  trustedOrigins: [new URL(env.BETTER_AUTH_URL).origin],
  disabledPaths: ["/token", "/unlink-account", ...rawClientMutationPaths],
  socialProviders:
    env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
      ? {
          google: {
            clientId: env.GOOGLE_CLIENT_ID,
            clientSecret: env.GOOGLE_CLIENT_SECRET,
          },
        }
      : {},
  hooks: {
    before: createAuthMiddleware(async (context) => {
      if (context.path === "/oauth2/token") await ensureIdTokenKey(context);
      if (context.path === "/sign-in/social" && isLinkOnlyProvider(context.body?.provider)) {
        throw new APIError("BAD_REQUEST", {
          code: "TELEGRAM_LINK_ONLY",
          message: "Telegram can only be connected to an existing account.",
        });
      }
      if (context.path === "/oauth2/register") {
        // Anonymous registration exists for MCP agents only. Applications in the shared pool
        // are registered from the application pages, which check them under the RBAC lock.
        if (await auth.api.getSession({ headers: context.headers ?? new Headers() }))
          throw new APIError("FORBIDDEN", {
            error: "access_denied",
            error_description: "Register applications from the application pages.",
          });
        const registration = checkMcpRegistration(context.body);
        if (registration.problem)
          throw new APIError("BAD_REQUEST", {
            error: "invalid_client_metadata",
            error_description: registration.problem,
          });
        return {
          context: {
            body: {
              ...context.body,
              application_type: registration.applicationType,
              scope: registration.scope,
            },
          },
        };
      }
      // Agents' sign-ins always end in a token for the MCP server and nothing more.
      if (context.path === "/oauth2/authorize") {
        const fromBody = context.method === "POST";
        const params = fromBody ? context.body : context.query;
        const rewritten = params && (await mcpAuthorizationRequest(params));
        if (rewritten) return { context: fromBody ? { body: rewritten } : { query: rewritten } };
      }
      if (refusedClientMutationPaths.includes(context.path))
        throw new APIError("FORBIDDEN", {
          code: "CLIENT_MUTATION_UNSUPPORTED",
          message: "Change applications from the application pages.",
        });
      if (context.path !== "/admin/oauth2/create-client") return;
      const body = context.body as Record<string, unknown> | undefined;
      // The provider trims grant names before storing them, so this must too.
      const protectedClient =
        (Array.isArray(body?.grant_types) &&
          body.grant_types.some(
            (grant) => typeof grant === "string" && grant.trim() === "client_credentials",
          )) ||
        (Array.isArray(body?.client_credentials_scopes) &&
          body.client_credentials_scopes.length > 0) ||
        (typeof body?.scope === "string" && body.scope.split(" ").some(isApiScope));
      // Any writer may register a private key, so creation applies the same key rules as the
      // application form, not only the provider's looser ones.
      if (body?.jwks_uri !== undefined)
        throw new APIError("BAD_REQUEST", {
          code: "JWKS_URI_UNSUPPORTED",
          message: "Register the public JWKS itself, not a jwks_uri.",
        });
      if (body?.jwks !== undefined) {
        try {
          await validateClientJwks(parsePublicJwks(JSON.stringify(body.jwks)), db);
        } catch (error) {
          throw new APIError("BAD_REQUEST", {
            code: "INVALID_JWKS",
            message: error instanceof Error ? error.message : "The public JWKS is invalid.",
          });
        }
      }
      if (protectedClient) {
        const session = await auth.api.getSession({ headers: context.headers ?? new Headers() });
        if (!session || !(await canAdministerIdp(session.user.id, db, true)))
          throw new APIError("UNAUTHORIZED", {
            code: "MASTER_ADMIN_REQUIRED",
            message: "Only Master Admin may manage applications with API access.",
          });
      }
    }),
    after: createAuthMiddleware(async (context) => {
      if (context.path === "/oauth2/register") {
        const registered = registeredClientSchema.safeParse(context.context.returned);
        if (registered.success) await finishMcpRegistration(registered.data.client_id);
        return;
      }
      if (context.path === "/passkey/generate-register-options" && context.context.session) {
        const options = registrationOptionsSchema.safeParse(context.context.returned);
        if (!options.success) return;
        const { user } = context.context.session;
        const accounts = await db
          .select({ providerId: schema.account.providerId, idToken: schema.account.idToken })
          .from(schema.account)
          .where(eq(schema.account.userId, user.id));
        const username = passkeyUsername(user, accounts);
        return context.json({
          ...options.data,
          user: { ...options.data.user, name: username, displayName: username },
        });
      }
      if (context.path === "/passkey/list-user-passkeys" && context.context.session) {
        const passkeys = passkeyListSchema.safeParse(context.context.returned);
        if (!passkeys.success) return;
        return context.json(passkeys.data.map((item) => ({ ...item, name: passkeyLabel(item) })));
      }
    }),
  },
  account: {
    accountLinking: {
      enabled: true,
      disableImplicitLinking: true,
      allowDifferentEmails: true,
      allowUnlinkingAll: false,
      trustedProviders: ["google", "pn-entra", "telegram"],
    },
  },
  session: { cookieCache: { enabled: false }, freshAge: SESSION_FRESH_AGE },
  advanced: { cookiePrefix: AUTH_COOKIE_PREFIX, ipAddress: clientIpOptions(env) },
  rateLimit: { enabled: true, customStorage: postgresRateLimitStorage(db) },
  plugins: [
    passkey({
      rpName: "PoliNetwork Auth",
      rpID: new URL(env.BETTER_AUTH_URL).hostname,
      origin: new URL(env.BETTER_AUTH_URL).origin,
      authenticatorSelection: { residentKey: "required", userVerification: "required" },
      registration: {
        afterVerification: async ({ verification }) => ({
          name: getAuthenticatorName(verification.registrationInfo?.aaguid),
        }),
      },
    }),
    genericOAuth({ config: providers }),
    jwt(jwtOptions),
    oauthProvider({
      loginPage: "/",
      consentPage: "/consent",
      scopes: serviceOAuthEnabled
        ? ["polinetwork:identity", ...backendScopes, "idp:access:read", MCP_SCOPE]
        : ["openid", "profile", "email", "polinetwork:identity", "offline_access", MCP_SCOPE],
      grantTypes: serviceOAuthEnabled
        ? ["authorization_code", "refresh_token", "client_credentials"]
        : ["authorization_code", "refresh_token"],
      resources: [mcpResourcePolicy, ...serviceResources],
      resourceSeedMode: "overwrite",
      rateLimit: oauthRateLimit,
      enforcePerClientResources: true,
      // Open to MCP agents only: the `/oauth2/register` hooks refuse anything else, these
      // scopes are all such a client may ever ask for, and it is linked to the MCP server
      // alone, so its tokens are useless anywhere else.
      allowDynamicClientRegistration: true,
      allowUnauthenticatedClientRegistration: true,
      clientRegistrationDefaultScopes: MCP_CLIENT_SCOPES,
      // Lets the login page name the requesting app before the user signs in.
      allowPublicClientPrelogin: true,
      // Offers a passkey once, on the way to the app; the page continues the sign-in after.
      postLogin: {
        page: PASSKEY_PROMPT_PAGE,
        consentReferenceId: () => undefined,
        shouldRedirect: async ({ headers, user, session }) => {
          const query = new URLSearchParams((await getOAuthProviderState())?.query ?? "");
          return shouldOfferPasskey({
            ...(await readPasskeyPromptState(user.id)),
            unsupportedBrowser: parseCookies(headers.get("cookie") ?? "").has(
              PASSKEY_UNSUPPORTED_COOKIE,
            ),
            sessionCreatedAt: new Date(session.createdAt),
            prompt: query.get("prompt"),
          });
        },
      },
      // Administrators share one client pool instead of owning clients individually.
      clientReference: () => OIDC_CLIENT_REFERENCE,
      clientPrivileges: async ({ user, action }) => {
        const requiresMasterAdmin = action === "configure-client-credentials-scopes";
        const allowed = user
          ? requiresMasterAdmin
            ? await canAdministerIdp(user.id, db, true)
            : await hasIdpPermission(user.id, "idp:applications:write")
          : false;
        if (!allowed)
          logAuthorizationDenial(user?.id ?? null, `oauth-client:${action}`, [
            requiresMasterAdmin ? "master-admin" : "idp:applications:write",
          ]);
        return allowed;
      },
      // Resource policy is seeded from config. Master Admin may inspect it, but no API caller
      // may edit it, and clients are linked only by saving them, under the RBAC write lock.
      resourcePrivileges: ({ action, user }) =>
        serviceOAuthEnabled && user && ["read", "list"].includes(action)
          ? canAdministerIdp(user.id, db, true)
          : false,
      accessTokenExpiresIn: tokenLifetimes.accessToken,
      m2mAccessTokenExpiresIn: tokenLifetimes.clientCredentialsAccessToken,
      refreshTokenExpiresIn: tokenLifetimes.refreshToken,
      refreshTokenReuseInterval: 10,
      idTokenExpiresIn: tokenLifetimes.idToken,
      customIdTokenClaims: async ({ user, scopes }) => ({
        ...standardIdTokenClaims(await withAppEmail(user, scopes), scopes),
        ...(await getOidcClaims(user.id, scopes)),
      }),
      customUserInfoClaims: async ({ user, scopes }) => ({
        ...standardIdTokenClaims(await withAppEmail(user, scopes), scopes),
        ...(await getOidcClaims(user.id, scopes)),
      }),
      customAccessTokenClaims: async ({ user, scopes }) => ({
        pn_subject_type: user ? "user" : "client",
        ...(user ? await getOidcClaims(user.id, scopes) : {}),
      }),
    }),
    tanstackStartCookies(),
  ],
});

if (import.meta.env.PROD) {
  startAccessDispatcher(auth);
  startKeyPruning();
  startDataRetention();
}
