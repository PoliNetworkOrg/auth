import { oauthProvider } from "@better-auth/oauth-provider";
import { getAuthenticatorName, passkey } from "@better-auth/passkey";
import { eq } from "drizzle-orm";
import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { genericOAuth } from "better-auth/plugins/generic-oauth";
import { jwt } from "better-auth/plugins/jwt";
import { tanstackStartCookies } from "better-auth/tanstack-start";
import { db } from "../db";
import * as schema from "../db/schema";
import { env } from "../env";
import { getOidcClaims } from "./identity";
import { isLinkOnlyProvider } from "./policy";
import { providers } from "./providers";
import {
  passkeyLabel,
  passkeyListSchema,
  passkeyUsername,
  registrationOptionsSchema,
} from "./passkeys";

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
      if (context.path === "/sign-in/social" && isLinkOnlyProvider(context.body?.provider)) {
        throw new APIError("BAD_REQUEST", {
          code: "TELEGRAM_LINK_ONLY",
          message: "Telegram can only be connected to an existing account.",
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
    jwt(),
    oauthProvider({
      loginPage: "/",
      consentPage: "/consent",
      scopes: ["openid", "profile", "polinetwork:identity", "offline_access"],
      grantTypes: ["authorization_code", "refresh_token"],
      allowDynamicClientRegistration: false,
      clientPrivileges: ({ user }) => !!user && env.IDP_ADMIN_USER_IDS.includes(user.id),
      accessTokenExpiresIn: 300,
      idTokenExpiresIn: 300,
      customIdTokenClaims: ({ user, scopes }) => getOidcClaims(user.id, scopes),
      customUserInfoClaims: ({ user, scopes }) => getOidcClaims(user.id, scopes),
      customAccessTokenClaims: ({ user, scopes }) => (user ? getOidcClaims(user.id, scopes) : {}),
    }),
    tanstackStartCookies(),
  ],
});
