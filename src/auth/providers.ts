import { createRemoteJWKSet, jwtVerify } from "jose";
import type { GenericOAuthConfig } from "better-auth/plugins/generic-oauth";
import { identityEvidence } from "../db/evidence";
import { db } from "../db/index";
import { env } from "../env";
import { hasAppRole } from "./policy";

type ProviderSettings = {
  clientId: string;
  clientSecret: string;
  tenantId?: string;
  requiredRole?: string;
};

function makeProvider(id: string, settings: ProviderSettings): GenericOAuthConfig {
  const telegram = id === "telegram";
  const issuer = telegram
    ? "https://oauth.telegram.org"
    : `https://login.microsoftonline.com/${settings.tenantId}/v2.0`;
  const jwks = createRemoteJWKSet(
    new URL(
      telegram
        ? `${issuer}/.well-known/jwks.json`
        : `https://login.microsoftonline.com/${settings.tenantId}/discovery/v2.0/keys`,
    ),
  );
  return {
    providerId: id,
    clientId: settings.clientId,
    clientSecret: settings.clientSecret,
    discoveryUrl: `${issuer}/.well-known/openid-configuration`,
    requireIdTokenVerification: true,
    scopes: telegram ? ["openid", "profile"] : ["openid", "profile", "email"],
    pkce: true,
    authentication: telegram ? "basic" : "post",
    disableSignUp: telegram,
    async getUserInfo(tokens) {
      if (!tokens.idToken) throw new Error("Provider did not return an ID token");
      const { payload } = await jwtVerify(tokens.idToken, jwks, {
        issuer,
        audience: settings.clientId,
        algorithms: ["RS256"],
        requiredClaims: ["sub", "exp", "iat"],
      });
      if (!payload.sub || !payload.exp) throw new Error("Missing identity claims");
      if (!telegram && payload.tid !== settings.tenantId)
        throw new Error("Unexpected Entra tenant");
      const telegramId =
        telegram &&
        (typeof payload.id === "string" ||
          (typeof payload.id === "number" && Number.isSafeInteger(payload.id)))
          ? String(payload.id)
          : null;
      if (telegram && !/^[1-9]\d*$/.test(telegramId!)) throw new Error("Missing Telegram user ID");
      const state =
        !telegram && settings.requiredRole && hasAppRole(payload.roles, settings.requiredRole)
          ? "socio"
          : null;
      const proof = {
        issuer,
        subject: payload.sub,
        providerId: id,
        state,
        validUntil: new Date(payload.exp * 1000),
        telegramId,
      };
      await db
        .insert(identityEvidence)
        .values(proof)
        .onConflictDoUpdate({
          target: [identityEvidence.issuer, identityEvidence.subject],
          set: proof,
        });
      return {
        ...payload,
        sub: payload.sub,
        name: typeof payload.name === "string" ? payload.name : "PoliNetwork user",
        email: `${id}.${Buffer.from(payload.sub).toString("base64url")}@identity.invalid`,
        emailVerified: false,
        image: typeof payload.picture === "string" ? payload.picture : undefined,
      };
    },
  };
}

const pnEntra =
  env.PN_ENTRA_CLIENT_ID && env.PN_ENTRA_CLIENT_SECRET && env.PN_ENTRA_TENANT_ID
    ? makeProvider("pn-entra", {
        clientId: env.PN_ENTRA_CLIENT_ID,
        clientSecret: env.PN_ENTRA_CLIENT_SECRET,
        tenantId: env.PN_ENTRA_TENANT_ID,
        requiredRole: env.PN_ENTRA_REQUIRED_ROLE,
      })
    : undefined;

const telegram =
  env.TELEGRAM_CLIENT_ID && env.TELEGRAM_CLIENT_SECRET
    ? makeProvider("telegram", {
        clientId: env.TELEGRAM_CLIENT_ID,
        clientSecret: env.TELEGRAM_CLIENT_SECRET,
      })
    : undefined;

export const providers = [pnEntra, telegram].filter(
  (provider): provider is GenericOAuthConfig => provider !== undefined,
);
