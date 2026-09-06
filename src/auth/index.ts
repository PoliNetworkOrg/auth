import { oauthProvider } from "@better-auth/oauth-provider";
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

export const auth = betterAuth({
  appName: "PoliNetwork Identity",
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
