import { oauthProvider } from "@better-auth/oauth-provider";
import { getAuthenticatorName, passkey } from "@better-auth/passkey";
import { eq } from "drizzle-orm";
import { betterAuth, type User } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { genericOAuth } from "better-auth/plugins/generic-oauth";
import { jwt } from "better-auth/plugins/jwt";
import { tanstackStartCookies } from "better-auth/tanstack-start";
import { db } from "../db";
import * as schema from "../db/schema";
import { env } from "../env";
import { AUTH_COOKIE_PREFIX } from "./cookies";
import { appEmail } from "./contact-email";
import { startAccessDispatcher } from "./access-dispatcher";
import { getOidcClaims } from "./identity";
import { ensureIdTokenKey, jwtOptions } from "./jwt-options";
import { startKeyPruning } from "./key-pruning";
import { logAuthorizationDenial } from "./denial-log";
import { hasIdpPermission } from "./idp-access";
import { canAdministerIdp } from "./oidc-admin";
import { OIDC_CLIENT_REFERENCE } from "./oidc-clients";
import { isServiceClient } from "./service-client-policy";
import { isLinkOnlyProvider, standardIdTokenClaims } from "./policy";
import { providers } from "./providers";
import {
  passkeyLabel,
  passkeyListSchema,
  passkeyUsername,
  registrationOptionsSchema,
} from "./passkeys";

const backendScopes = [
  "openid",
  "profile",
  "email",
  "offline_access",
  "backend:admin",
  "backend:public:read",
  "backend:tg:read",
  "backend:tg:ingest",
  "backend:tg:groups:sync",
  "backend:tg:audit",
  "backend:tg:act-as",
  "backend:tg:events",
];
const serviceOAuthEnabled = Boolean(
  env.OAUTH_BACKEND_RESOURCE_URI && env.OAUTH_INTERNAL_RESOURCE_URI,
);
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
  disabledPaths: ["/token", "/unlink-account"],
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
      const body = context.body as Record<string, unknown> | undefined;
      const creation = ["/oauth2/create-client", "/admin/oauth2/create-client"].includes(
        context.path,
      );
      const mutation = [
        "/oauth2/update-client",
        "/oauth2/delete-client",
        "/oauth2/client/rotate-secret",
        "/admin/oauth2/update-client",
      ].includes(context.path);
      let protectedClient = false;
      if (creation)
        protectedClient =
          body?.token_endpoint_auth_method === "private_key_jwt" ||
          (typeof body?.scope === "string" &&
            body.scope
              .split(" ")
              .some((scope) => scope.startsWith("backend:") || scope === "idp:access:read"));
      if (mutation && typeof body?.client_id === "string") {
        const [client] = await db
          .select({
            tokenEndpointAuthMethod: schema.oauthClient.tokenEndpointAuthMethod,
            grantTypes: schema.oauthClient.grantTypes,
            clientCredentialsScopes: schema.oauthClient.clientCredentialsScopes,
            scopes: schema.oauthClient.scopes,
          })
          .from(schema.oauthClient)
          .where(eq(schema.oauthClient.clientId, body.client_id));
        protectedClient = Boolean(client && isServiceClient(client));
        const update = body.update as Record<string, unknown> | undefined;
        if (
          update?.token_endpoint_auth_method === "private_key_jwt" ||
          (typeof update?.scope === "string" &&
            update.scope
              .split(" ")
              .some((scope) => scope.startsWith("backend:") || scope === "idp:access:read"))
        )
          protectedClient = true;
      }
      if (protectedClient) {
        const session = await auth.api.getSession({ headers: context.headers ?? new Headers() });
        if (!session || !(await canAdministerIdp(session.user.id, db, true)))
          throw new APIError("UNAUTHORIZED", {
            code: "MASTER_ADMIN_REQUIRED",
            message: "Only Master Admin may manage service clients.",
          });
      }
    }),
    after: createAuthMiddleware(async (context) => {
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
  session: { cookieCache: { enabled: false } },
  advanced: { cookiePrefix: AUTH_COOKIE_PREFIX },
  rateLimit: { enabled: true, storage: "database" },
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
        ? ["polinetwork:identity", ...backendScopes, "idp:access:read"]
        : ["openid", "profile", "email", "polinetwork:identity", "offline_access"],
      grantTypes: serviceOAuthEnabled
        ? ["authorization_code", "refresh_token", "client_credentials"]
        : ["authorization_code", "refresh_token"],
      resources: serviceResources,
      resourceSeedMode: "overwrite",
      enforcePerClientResources: true,
      allowDynamicClientRegistration: false,
      // Lets the login page name the requesting app before the user signs in.
      allowPublicClientPrelogin: true,
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
      // Resource policy is seeded from config. Master Admin may inspect/link clients,
      // but no API caller may edit the resource policy itself.
      resourcePrivileges: ({ action, user }) =>
        serviceOAuthEnabled && user && ["read", "list", "link", "unlink"].includes(action)
          ? canAdministerIdp(user.id, db, true)
          : false,
      accessTokenExpiresIn: 300,
      m2mAccessTokenExpiresIn: 3600,
      refreshTokenReuseInterval: 10,
      idTokenExpiresIn: 300,
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
}
