import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, randomBytes, randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { jwt } from "better-auth/plugins/jwt";
import { oauthProvider } from "@better-auth/oauth-provider";
import { decodeJwt, decodeProtectedHeader, exportJWK, SignJWT } from "jose";
import { Pool } from "pg";
import * as schema from "../src/db/schema";

const databaseURL = process.env.PHASE0_DATABASE_URL;
assert(databaseURL, "Set PHASE0_DATABASE_URL to a disposable, migrated local PostgreSQL database");
const database = new URL(databaseURL);
assert(["localhost", "127.0.0.1", "[::1]"].includes(database.hostname));
assert(database.pathname === "/auth_phase0", "The database must be named auth_phase0");

const origin = "http://localhost:35440";
const issuer = `${origin}/api/auth`;
const redirectURI = "https://dashboard.phase0.invalid/callback";
const backendResource = "https://backend.internal.polinetwork.org";
const internalResource = "https://auth.polinetwork.org/api/internal";
const backendScopes = [
  "openid",
  "profile",
  "email",
  "offline_access",
  "backend:admin",
  "backend:tg:read",
  "backend:tg:ingest",
  "backend:tg:groups:sync",
  "backend:tg:audit",
  "backend:tg:act-as",
  "backend:tg:events",
  "backend:public:read",
];
const botScopes = backendScopes.filter((scope) => scope.startsWith("backend:tg:"));
const pool = new Pool({ connectionString: databaseURL });
const db = drizzle({ client: pool, schema });

function createProvider() {
  return betterAuth({
    baseURL: origin,
    secret: "phase0-disposable-only-secret-longer-than-32-characters",
    database: drizzleAdapter(db, { provider: "pg", schema }),
    trustedOrigins: [origin],
    emailAndPassword: { enabled: true },
    plugins: [
      jwt(),
      oauthProvider({
        loginPage: "/",
        consentPage: "/consent",
        scopes: ["polinetwork:identity", ...backendScopes, "idp:access:read"],
        grantTypes: ["authorization_code", "refresh_token", "client_credentials"],
        allowDynamicClientRegistration: false,
        clientPrivileges: () => true,
        resourcePrivileges: () => true,
        accessTokenExpiresIn: 300,
        m2mAccessTokenExpiresIn: 3600,
        refreshTokenReuseInterval: 10,
        resources: [
          {
            identifier: backendResource,
            accessTokenTtl: 3600,
            refreshTokenTtl: 604800,
            allowedScopes: backendScopes,
          },
          { identifier: internalResource, accessTokenTtl: 300, allowedScopes: ["idp:access:read"] },
        ],
        resourceSeedMode: "overwrite",
        customAccessTokenClaims: ({ user }) => ({ pn_subject_type: user ? "user" : "client" }),
      }),
    ],
  });
}

let auth = createProvider();

async function request(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("Origin", origin);
  return auth.handler(
    new Request(`${origin}${path}`, {
      ...init,
      headers,
      redirect: "manual",
    }),
  );
}

async function jsonRequest(path: string, body: object, cookie?: string) {
  return request(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify(body),
  });
}

async function bodyOrFail(response: Response, status: number) {
  const text = await response.text();
  assert.equal(response.status, status, text.slice(0, 400));
  return JSON.parse(text);
}

async function tokenRequest(body: URLSearchParams, clientId: string, credentials: string) {
  const response = await request("/api/auth/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: credentials },
    body,
  });
  const result = await response.json();
  return { status: response.status, result, clientId };
}

function decoded(accessToken: string) {
  const claims = decodeJwt(accessToken);
  const { alg, typ } = decodeProtectedHeader(accessToken);
  const { iss, sub, client_id, azp, aud, scope, pn_subject_type, iat, exp } = claims;
  return {
    header: { alg, typ },
    claims: { iss, sub, client_id, azp, aud, scope, pn_subject_type, iat, exp },
    ttlSeconds: Number(exp) - Number(iat),
  };
}

async function main() {
  const signup = await jsonRequest("/api/auth/sign-up/email", {
    name: "Phase Zero",
    email: `phase0-${randomUUID()}@identity.invalid`,
    password: randomBytes(28).toString("base64url"),
  });
  await bodyOrFail(signup, 200);
  const cookie = signup.headers
    .getSetCookie()
    .find((value) => value.includes("session_token="))
    ?.split(";")[0];
  assert(cookie, "Test sign-up did not create a session cookie");

  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const publicJwk = await exportJWK(publicKey);
  const keyId = "phase0-key";
  const keySet = { keys: [{ ...publicJwk, kid: keyId, alg: "ES256", use: "sig" }] };
  const adminHeaders = new Headers({ Cookie: cookie });
  const bot = await auth.api.adminCreateOAuthClient({
    headers: adminHeaders,
    body: {
      client_name: "Phase 0 Bot",
      token_endpoint_auth_method: "private_key_jwt",
      grant_types: ["client_credentials"],
      client_credentials_scopes: botScopes,
      jwks: keySet,
    },
  });
  const backend = await auth.api.adminCreateOAuthClient({
    headers: adminHeaders,
    body: {
      client_name: "Phase 0 Backend",
      token_endpoint_auth_method: "private_key_jwt",
      grant_types: ["client_credentials"],
      client_credentials_scopes: ["idp:access:read"],
      jwks: keySet,
    },
  });
  const scopeProbe = await auth.api.adminCreateOAuthClient({
    headers: adminHeaders,
    body: {
      client_name: "Phase 0 Scope Probe",
      token_endpoint_auth_method: "private_key_jwt",
      grant_types: ["client_credentials"],
      client_credentials_scopes: ["backend:public:read", "idp:access:read"],
      jwks: keySet,
    },
  });
  const dashboard = await auth.api.adminCreateOAuthClient({
    headers: adminHeaders,
    body: {
      client_name: "Phase 0 Dashboard",
      token_endpoint_auth_method: "client_secret_basic",
      redirect_uris: [redirectURI],
      grant_types: ["authorization_code", "refresh_token"],
      scope: "openid profile email offline_access backend:admin",
      skip_consent: true,
    },
  });

  for (const [clientId, resource] of [
    [bot.client_id, backendResource],
    [backend.client_id, internalResource],
    [dashboard.client_id, backendResource],
    [scopeProbe.client_id, backendResource],
  ]) {
    await auth.api.adminLinkClientResource({
      headers: adminHeaders,
      params: { identifier: resource, client_id: clientId },
    });
  }

  async function assertion(clientId: string) {
    return new SignJWT({})
      .setProtectedHeader({ alg: "ES256", kid: keyId })
      .setIssuer(clientId)
      .setSubject(clientId)
      .setAudience(`${issuer}/oauth2/token`)
      .setIssuedAt()
      .setExpirationTime("2m")
      .setJti(randomUUID())
      .sign(privateKey);
  }

  async function serviceToken(clientId: string, resource: string, scope: string) {
    const body = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
      client_assertion: await assertion(clientId),
      resource,
      scope,
    });
    const { status, result } = await tokenRequest(body, clientId, "");
    assert.equal(status, 200, JSON.stringify(result));
    return result;
  }

  const botToken = await serviceToken(bot.client_id, backendResource, botScopes.join(" "));
  assert.equal(decoded(botToken.access_token).ttlSeconds, 3600);
  assert.equal(decoded(botToken.access_token).claims.aud, backendResource);
  const excessScope = await tokenRequest(
    new URLSearchParams({
      grant_type: "client_credentials",
      client_id: bot.client_id,
      client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
      client_assertion: await assertion(bot.client_id),
      resource: backendResource,
      scope: [...botScopes, "backend:admin"].join(" "),
    }),
    bot.client_id,
    "",
  );
  const snapshotToken = await serviceToken(backend.client_id, internalResource, "idp:access:read");
  assert.equal(decoded(snapshotToken.access_token).ttlSeconds, 300);
  assert.equal(decoded(snapshotToken.access_token).claims.aud, internalResource);
  const resourceScope = await serviceToken(
    scopeProbe.client_id,
    backendResource,
    "backend:public:read idp:access:read",
  );
  assert.equal(decoded(resourceScope.access_token).claims.scope, "backend:public:read");
  const opaque = await tokenRequest(
    new URLSearchParams({
      grant_type: "client_credentials",
      client_id: bot.client_id,
      client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
      client_assertion: await assertion(bot.client_id),
      scope: "backend:tg:read",
    }),
    bot.client_id,
    "",
  );

  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const authorization = new URL(`${issuer}/oauth2/authorize`);
  for (const [key, value] of Object.entries({
    client_id: dashboard.client_id,
    redirect_uri: redirectURI,
    response_type: "code",
    scope: "openid profile email offline_access backend:admin",
    resource: backendResource,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state: randomUUID(),
  }))
    authorization.searchParams.set(key, value);
  const authorizeResponse = await request(authorization.pathname + authorization.search, {
    headers: { Cookie: cookie },
  });
  assert.equal(authorizeResponse.status, 302, await authorizeResponse.text());
  const location = authorizeResponse.headers.get("Location");
  assert(location, "Authorization did not redirect");
  const authorizationCode = new URL(location, origin).searchParams.get("code");
  assert(authorizationCode, `Authorization did not issue a code: ${location}`);

  const dashboardCredentials = `Basic ${Buffer.from(`${dashboard.client_id}:${dashboard.client_secret}`).toString("base64")}`;
  const userTokenRequest = new URLSearchParams({
    grant_type: "authorization_code",
    code: authorizationCode,
    code_verifier: verifier,
    redirect_uri: redirectURI,
    resource: backendResource,
  });
  const userResponse = await tokenRequest(
    userTokenRequest,
    dashboard.client_id,
    dashboardCredentials,
  );
  assert.equal(userResponse.status, 200, JSON.stringify(userResponse.result));
  const userToken = userResponse.result;
  assert(userToken.refresh_token, "User token did not include a refresh token");
  assert(userToken.id_token, "User token did not include an ID token");
  assert.equal(decoded(userToken.access_token).ttlSeconds, 300);
  assert.deepEqual(decoded(userToken.access_token).claims.aud, [
    backendResource,
    `${issuer}/oauth2/userinfo`,
  ]);
  assert.equal(opaque.status, 200);
  assert.equal(opaque.result.access_token.split(".").length !== 3, true);
  assert.equal(excessScope.status, 400);
  assert.equal(excessScope.result.error, "invalid_scope");
  const refreshLifetime = await pool.query(
    `SELECT EXTRACT(EPOCH FROM (expires_at - created_at)) AS seconds
     FROM oauth_refresh_token WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [decoded(userToken.access_token).claims.sub],
  );
  const refreshTtlSeconds = Number(refreshLifetime.rows[0].seconds);
  assert.equal(refreshTtlSeconds, 604800);

  function refresh(refreshToken: string) {
    return tokenRequest(
      new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        resource: backendResource,
      }),
      dashboard.client_id,
      dashboardCredentials,
    );
  }

  const firstRefresh = await refresh(userToken.refresh_token);
  assert.equal(firstRefresh.status, 200, JSON.stringify(firstRefresh.result));
  const replayWithinInterval = await refresh(userToken.refresh_token);
  assert.equal(replayWithinInterval.status, 200, JSON.stringify(replayWithinInterval.result));
  assert.equal(replayWithinInterval.result.refresh_token, firstRefresh.result.refresh_token);
  const [parallelOne, parallelTwo] = await Promise.all([
    refresh(firstRefresh.result.refresh_token),
    refresh(firstRefresh.result.refresh_token),
  ]);
  const survivor = [parallelOne, parallelTwo].find((response) => response.status === 200);
  assert(survivor, "Parallel refreshes both failed");
  await new Promise((resolve) => setTimeout(resolve, 11_000));
  const lateReplay = await refresh(firstRefresh.result.refresh_token);
  const afterInvalidation = await refresh(survivor.result.refresh_token);
  assert.equal(lateReplay.status, 400);
  assert.equal(afterInvalidation.status, 400);

  const originalResource = await pool.query(
    "SELECT allowed_scopes FROM oauth_resource WHERE identifier = $1",
    [backendResource],
  );
  assert.deepEqual(originalResource.rows[0].allowed_scopes, backendScopes);
  await pool.query(
    "UPDATE oauth_resource SET allowed_scopes = ARRAY['backend:public:read'] WHERE identifier = $1",
    [backendResource],
  );
  auth = createProvider();
  await auth.$context;
  const reseeded = await pool.query(
    "SELECT allowed_scopes FROM oauth_resource WHERE identifier = $1",
    [backendResource],
  );
  const seedOverwritten =
    JSON.stringify(reseeded.rows[0].allowed_scopes) === JSON.stringify(backendScopes);
  assert.equal(seedOverwritten, true);

  console.log(
    JSON.stringify(
      {
        provider: "@better-auth/oauth-provider 1.7.2, disposable PostgreSQL",
        bot: decoded(botToken.access_token),
        snapshot: decoded(snapshotToken.access_token),
        resourceScope: decoded(resourceScope.access_token),
        noResource: {
          status: opaque.status,
          opaque: opaque.status === 200 && opaque.result.access_token.split(".").length !== 3,
        },
        excessScope: { status: excessScope.status, error: excessScope.result.error },
        dashboard: decoded(userToken.access_token),
        refreshTtlSeconds,
        refresh: {
          first: { status: firstRefresh.status, token: decoded(firstRefresh.result.access_token) },
          replayWithinInterval: {
            status: replayWithinInterval.status,
            error: replayWithinInterval.result.error,
            matchesFirst:
              replayWithinInterval.status === 200 &&
              replayWithinInterval.result.refresh_token === firstRefresh.result.refresh_token,
          },
          parallel: {
            statuses: [parallelOne.status, parallelTwo.status],
            identicalResponse:
              parallelOne.status === 200 &&
              parallelTwo.status === 200 &&
              parallelOne.result.refresh_token === parallelTwo.result.refresh_token,
          },
          afterReuseInterval: { status: lateReplay.status, error: lateReplay.result.error },
          familyAfterReplay: {
            status: afterInvalidation.status,
            error: afterInvalidation.result.error,
          },
        },
        resourceSeedMode: {
          originalScopes: originalResource.rows[0].allowed_scopes,
          overwritten: seedOverwritten,
        },
      },
      null,
      2,
    ),
  );
}

try {
  await main();
} finally {
  await pool.end();
}
