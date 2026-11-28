import type { OAuth2Tokens } from "better-auth";
import type { GenericOAuthConfig } from "better-auth/plugins/generic-oauth";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import { and, eq, sql } from "drizzle-orm";
import { account } from "../db/auth-schema";
import { identityEvidence } from "../db/evidence";
import { db } from "../db/index";
import { authorizationMutationLock } from "../db/security-lock";
import { env } from "../env";
import { TELEGRAM_ISSUER, entraIssuer } from "./account-issuer";
import { claimEmail } from "./contact-email";
import { checkPnGroupStates, membershipEvidence } from "./membership";
import { entraNames } from "./name-store";
import { joinName } from "./names";
import { isEntraMember } from "./policy";
import { AccountRefused, recordProviderError } from "./provider-errors";
import { PROVIDER_ERROR_CODES } from "./sign-in-errors";

type ProviderSettings = {
  clientId: string;
  clientSecret: string;
  tenantId?: string;
};

/** Claim a verified Telegram ID after removing proof left by a failed or old link. */
export async function persistVerifiedEvidence(proof: typeof identityEvidence.$inferInsert) {
  if (proof.providerId !== "telegram") {
    await db
      .insert(identityEvidence)
      .values(proof)
      .onConflictDoUpdate({
        target: [identityEvidence.issuer, identityEvidence.subject],
        set: proof,
      });
    return;
  }
  if (!proof.telegramId || !/^[1-9]\d*$/.test(proof.telegramId))
    throw new Error("Verified Telegram proof requires a numeric user ID.");
  await db.transaction(async (transaction) => {
    await transaction.execute(authorizationMutationLock);
    await transaction.delete(identityEvidence).where(
      and(
        eq(identityEvidence.providerId, "telegram"),
        eq(identityEvidence.issuer, proof.issuer),
        eq(identityEvidence.telegramId, proof.telegramId!),
        sql`not exists (
          select 1 from ${account}
          where ${account.issuer} = ${identityEvidence.issuer}
            and ${account.accountId} = ${identityEvidence.subject}
            and ${account.providerId} = ${identityEvidence.providerId}
        )`,
      ),
    );
    await transaction
      .insert(identityEvidence)
      .values(proof)
      .onConflictDoUpdate({
        target: [identityEvidence.issuer, identityEvidence.subject],
        set: proof,
      });
  });
}

/** Telegram's `preferred_username`, without the @. Absent for people with no username. */
export function telegramUsername(claims: JWTPayload) {
  const name = claims.preferred_username;
  return typeof name === "string" && name ? name.replace(/^@/, "") : null;
}

/**
 * The account `verify` returns, or null when it throws. Better Auth sends a missing result to the
 * flow's error callback, as `unable_to_get_user_info`, but lets a throw escape it, so a refused
 * account would end on a bare error page instead of going back to `/link` or `/error`.
 */
export async function accountOrNull<T>(id: string, verify: () => Promise<T>): Promise<T | null> {
  try {
    return await verify();
  } catch (error) {
    // The reason only: jose's claim errors carry the whole ID token payload (name, email,
    // object ID), which must not reach the logs for someone who was refused.
    const code = error instanceof Error && "code" in error ? error.code : undefined;
    const reason =
      error instanceof Error
        ? `${typeof code === "string" ? code : error.name}: ${error.message}`
        : "non-error value thrown";
    const refused = error instanceof AccountRefused;
    console.error(`${refused ? "Refused" : "Couldn't verify"} a ${id} account: ${reason}`);
    // Better Auth reports every failure here the same way. A deliberate refusal keeps its own
    // code; anything else (keys unreachable, a bad token, the database) is a failure, so the
    // person is told to try again rather than that their account can't be used.
    await recordProviderError(refused ? error.code : PROVIDER_ERROR_CODES.failed);
    return null;
  }
}

function makeProvider(id: string, settings: ProviderSettings): GenericOAuthConfig {
  const telegram = id === "telegram";
  // The same issuer the account gets (`account-issuer.ts`), so evidence and account stay joined.
  const issuer = telegram ? TELEGRAM_ISSUER : entraIssuer(settings.tenantId!);
  const jwks = createRemoteJWKSet(
    new URL(
      telegram
        ? `${issuer}/.well-known/jwks.json`
        : `https://login.microsoftonline.com/${settings.tenantId}/discovery/v2.0/keys`,
    ),
  );
  /** The verified identity behind `tokens`, after saving its evidence. Throws when it's refused. */
  async function verifiedUserInfo(tokens: OAuth2Tokens) {
    if (!tokens.idToken) throw new Error("Provider did not return an ID token");
    const { payload } = await jwtVerify(tokens.idToken, jwks, {
      issuer,
      audience: settings.clientId,
      algorithms: ["RS256"],
      requiredClaims: ["sub", "exp", "iat"],
    });
    if (!payload.sub || !payload.exp)
      throw new AccountRefused(PROVIDER_ERROR_CODES.missingClaims, "Missing identity claims");
    if (!telegram && payload.tid !== settings.tenantId)
      throw new AccountRefused(PROVIDER_ERROR_CODES.entraTenant, "Unexpected Entra tenant");
    if (!telegram && !isEntraMember(payload.acct))
      throw new AccountRefused(
        PROVIDER_ERROR_CODES.entraGuest,
        "Entra guest accounts cannot sign in",
      );
    const telegramId =
      telegram &&
      (typeof payload.id === "string" ||
        (typeof payload.id === "number" && Number.isSafeInteger(payload.id)))
        ? String(payload.id)
        : null;
    if (telegram && !/^[1-9]\d*$/.test(telegramId!))
      throw new AccountRefused(PROVIDER_ERROR_CODES.missingClaims, "Missing Telegram user ID");
    if (!telegram && typeof payload.oid !== "string")
      throw new AccountRefused(
        PROVIDER_ERROR_CODES.missingClaims,
        "Missing Entra object ID for membership verification",
      );
    const [membership, names] = telegram
      ? [{ states: [], validUntil: new Date(payload.exp * 1000) }, null]
      : await Promise.all([
          checkPnGroupStates(payload.oid as string).then(membershipEvidence),
          entraNames(payload, payload.oid as string),
        ]);
    const proof = {
      issuer,
      subject: payload.sub,
      providerId: id,
      externalId: typeof payload.oid === "string" ? payload.oid : null,
      ...membership,
      telegramId,
      telegramUsername: telegramUsername(payload),
      // Saved on every sign-in, so people who signed up before this was kept get it the
      // next time they sign in.
      email: telegram ? null : (claimEmail(payload) ?? null),
      // The directory's names, which `syncNames` gives the person once the sign-in ends. Left out
      // when they couldn't be read, so the last ones read stay.
      ...names,
    };
    await persistVerifiedEvidence(proof);
    return {
      ...payload,
      sub: payload.sub,
      name:
        typeof payload.name === "string" && payload.name.trim()
          ? payload.name
          : (names && joinName(names)) || "PoliNetwork user",
      email: `${id}.${Buffer.from(payload.sub).toString("base64url")}@identity.invalid`,
      emailVerified: false,
      image: typeof payload.picture === "string" ? payload.picture : undefined,
    };
  }

  return {
    providerId: id,
    clientId: settings.clientId,
    clientSecret: settings.clientSecret,
    discoveryUrl: `${issuer}/.well-known/openid-configuration`,
    // Signing out of PoliNetwork must preserve the upstream provider session.
    disableProviderLogout: true,
    requireIdTokenVerification: true,
    scopes: telegram ? ["openid", "profile"] : ["openid", "profile", "email"],
    pkce: true,
    authentication: telegram ? "basic" : "post",
    disableSignUp: telegram,
    getUserInfo: (tokens) => accountOrNull(id, () => verifiedUserInfo(tokens)),
  };
}

const pnEntra =
  env.PN_ENTRA_CLIENT_ID && env.PN_ENTRA_CLIENT_SECRET && env.PN_ENTRA_TENANT_ID
    ? makeProvider("pn-entra", {
        clientId: env.PN_ENTRA_CLIENT_ID,
        clientSecret: env.PN_ENTRA_CLIENT_SECRET,
        tenantId: env.PN_ENTRA_TENANT_ID,
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
