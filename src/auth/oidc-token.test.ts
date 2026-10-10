import { oauthProvider } from "@better-auth/oauth-provider";
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { generateCodeChallenge } from "better-auth/oauth2";
import { jwt } from "better-auth/plugins/jwt";
import { createLocalJWKSet, jwtVerify } from "jose";
import { describe, expect, it } from "vite-plus/test";
import { jwtOptions } from "./jwt-options";
import { standardIdTokenClaims } from "./policy";

const baseURL = "https://auth.polinetwork.test";
const redirectURI = "https://app.polinetwork.test/callback";

async function issueTokens(scopes: string[], customClaims = true) {
  const database = memoryAdapter({
    user: [],
    session: [],
    account: [],
    verification: [],
    jwks: [],
    oauthClient: [],
    oauthAccessToken: [],
    oauthRefreshToken: [],
    oauthConsent: [],
  });
  // Model the user after withAppEmail has resolved the linked organization address.
  const appUser = { name: "Member", email: "member@polinetwork.org", emailVerified: true };
  const auth = betterAuth({
    baseURL,
    secret: "oidc-token-test-secret-at-least-32-characters",
    database,
    emailAndPassword: { enabled: true },
    plugins: [
      jwt(jwtOptions),
      oauthProvider({
        loginPage: "/",
        consentPage: "/consent",
        scopes: ["openid", "profile", "email", "offline_access"],
        customIdTokenClaims: customClaims
          ? ({ scopes }) => standardIdTokenClaims(appUser, scopes)
          : undefined,
        customUserInfoClaims: ({ scopes }) => standardIdTokenClaims(appUser, scopes),
      }),
    ],
  });
  const signUp = await auth.api.signUpEmail({
    body: { email: "member@outlook.it", name: "Member", password: "test-password-at-least-16" },
    asResponse: true,
  });
  expect(signUp.status).toBe(200);
  const headers = new Headers({
    cookie: signUp.headers
      .getSetCookie()
      .map((value) => value.split(";")[0])
      .join("; "),
  });
  const client = await auth.api.adminCreateOAuthClient({
    headers,
    body: {
      redirect_uris: [redirectURI],
      token_endpoint_auth_method: "client_secret_post",
      grant_types: ["authorization_code", "refresh_token"],
      skip_consent: true,
    },
  });
  const authorizationURL = new URL(`${baseURL}/api/auth/oauth2/authorize`);
  const codeVerifier = "oidc-token-test-code-verifier-at-least-43-characters";
  authorizationURL.search = new URLSearchParams({
    client_id: client.client_id,
    redirect_uri: redirectURI,
    response_type: "code",
    scope: scopes.join(" "),
    state: "test-state",
    nonce: "test-nonce",
    code_challenge: await generateCodeChallenge(codeVerifier),
    code_challenge_method: "S256",
  }).toString();
  const authorization = await auth.handler(new Request(authorizationURL, { headers }));
  const location = authorization.headers.get("location");
  expect(location).toContain(`${redirectURI}?`);
  const code = new URL(location!).searchParams.get("code");
  expect(code, location!).toBeTruthy();
  const tokenResponse = await auth.handler(
    new Request(`${baseURL}/api/auth/oauth2/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: code!,
        redirect_uri: redirectURI,
        client_id: client.client_id,
        client_secret: client.client_secret!,
        code_verifier: codeVerifier,
      }),
    }),
  );
  expect(tokenResponse.status).toBe(200);
  const tokens = (await tokenResponse.json()) as { id_token: string; access_token: string };
  const jwks = await auth.api.getJwks();
  const verified = await jwtVerify(tokens.id_token, createLocalJWKSet(jwks), {
    issuer: `${baseURL}/api/auth`,
    audience: client.client_id,
    algorithms: ["RS256"],
  });
  const userInfoResponse = await auth.handler(
    new Request(`${baseURL}/api/auth/oauth2/userinfo`, {
      headers: { authorization: `Bearer ${tokens.access_token}` },
    }),
  );
  expect(userInfoResponse.status).toBe(200);
  const userInfo = (await userInfoResponse.json()) as Record<string, unknown>;
  return { payload: verified.payload, userInfo };
}

describe("OIDC standard claims in signed tokens", () => {
  it("preserves custom email claims in the signed RS256 ID token and UserInfo", async () => {
    const { payload, userInfo } = await issueTokens(["openid", "profile", "email"]);
    for (const claims of [payload, userInfo]) {
      expect(claims).toMatchObject({
        email: "member@polinetwork.org",
        email_verified: true,
        name: "Member",
      });
    }
    expect(payload.nonce).toBe("test-nonce");
    expect(userInfo.sub).toBe(payload.sub);
  });

  it("omits standard claims by default when the custom callback is absent", async () => {
    const { payload } = await issueTokens(["openid", "profile", "email"], false);
    expect(payload).not.toHaveProperty("email");
    expect(payload).not.toHaveProperty("email_verified");
    expect(payload).not.toHaveProperty("name");
  });

  it("omits email and profile claims when their scopes were not granted", async () => {
    const { payload, userInfo } = await issueTokens(["openid"]);
    for (const claims of [payload, userInfo]) {
      expect(claims).not.toHaveProperty("email");
      expect(claims).not.toHaveProperty("email_verified");
      expect(claims).not.toHaveProperty("name");
    }
  });
});
