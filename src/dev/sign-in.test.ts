import { oauthProvider } from "@better-auth/oauth-provider";
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { generateCodeChallenge } from "better-auth/oauth2";
import { jwt } from "better-auth/plugins/jwt";
import { describe, expect, it } from "vite-plus/test";
import { jwtOptions } from "../auth/jwt-options";
import { devSignIn } from "./sign-in";

const baseURL = "http://localhost:3000";
const redirectURI = "https://app.polinetwork.test/callback";

/** The same OAuth provider setup as the app, on an in-memory database. */
async function setup() {
  const auth = betterAuth({
    baseURL,
    secret: "dev-sign-in-test-secret-at-least-32-characters",
    database: memoryAdapter({
      user: [],
      session: [],
      account: [],
      verification: [],
      jwks: [],
      oauthClient: [],
      oauthAccessToken: [],
      oauthRefreshToken: [],
      oauthConsent: [],
    }),
    emailAndPassword: { enabled: true },
    plugins: [
      jwt(jwtOptions),
      oauthProvider({
        loginPage: "/",
        consentPage: "/consent",
        scopes: ["openid", "profile", "email"],
      }),
    ],
  });
  const signUp = await auth.api.signUpEmail({
    body: { email: "owner@example.test", name: "Owner", password: "test-password-at-least-16" },
    asResponse: true,
  });
  const ownerCookie = signUp.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
  const client = await auth.api.adminCreateOAuthClient({
    headers: new Headers({ cookie: ownerCookie }),
    body: {
      redirect_uris: [redirectURI],
      token_endpoint_auth_method: "client_secret_post",
      grant_types: ["authorization_code"],
    },
  });
  const context = await auth.$context;
  // Written straight to the database, as the dev seed does: no sign-up, so no session yet.
  const persona = await context.adapter.create<{ id: string }>({
    model: "user",
    data: { name: "Sam Staff", email: "staff@polinetwork.test", emailVerified: false },
  });
  return { auth, context, client, persona };
}

type Setup = Awaited<ReturnType<typeof setup>>;

/** Starts an authorization with no session, as an application would, and returns the signed
 * query of the login page it lands on. */
async function loginPageQuery({ auth, client }: Setup, extra: Record<string, string> = {}) {
  const url = new URL(`${baseURL}/api/auth/oauth2/authorize`);
  url.search = new URLSearchParams({
    client_id: client.client_id,
    redirect_uri: redirectURI,
    response_type: "code",
    scope: "openid profile",
    state: "test-state",
    code_challenge: await generateCodeChallenge("dev-sign-in-code-verifier-at-least-43-characters"),
    code_challenge_method: "S256",
    ...extra,
  }).toString();
  const response = await auth.handler(new Request(url));
  const location = new URL(response.headers.get("location")!, baseURL);
  expect(location.pathname).toBe("/");
  expect(location.searchParams.get("sig")).toBeTruthy();
  return location.search.slice(1);
}

function cookieHeader(cookies: string[]) {
  return cookies.map((value) => value.split(";")[0]).join("; ");
}

/** Approves the consent page the way `/consent` does and returns the redirect it produces. */
async function approve({ auth }: Setup, consentURL: string, cookies: string[]) {
  const response = await auth.handler(
    new Request(`${baseURL}/api/auth/oauth2/consent`, {
      method: "POST",
      headers: {
        cookie: cookieHeader(cookies),
        origin: baseURL,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        accept: true,
        oauth_query: new URL(consentURL, baseURL).search.slice(1),
      }),
    }),
  );
  expect(response.status).toBe(200);
  return new URL(((await response.json()) as { url: string }).url);
}

async function sessionsOf({ context }: Setup, userId: string) {
  return (await context.internalAdapter.listSessions(userId)).length;
}

describe("dev sign-in resuming OpenID Connect", () => {
  it("signs in without an authorization in progress", async () => {
    const setupResult = await setup();
    const result = await devSignIn(setupResult.auth, { userId: setupResult.persona.id });
    expect(result).toEqual({ ok: true, cookies: [expect.stringContaining("session_token=")] });
    expect(await sessionsOf(setupResult, setupResult.persona.id)).toBe(1);
  });

  it.each([
    ["a plain request", {}],
    ["prompt=login", { prompt: "login" }],
    ["max_age=0", { max_age: "0" }],
    ["prompt=login with max_age=0", { prompt: "login", max_age: "0" }],
  ])("resumes %s at the consent page, which then issues a code", async (_, extra) => {
    const setupResult = await setup();
    const query = await loginPageQuery(setupResult, extra);
    const result = await devSignIn(setupResult.auth, {
      userId: setupResult.persona.id,
      oauthQuery: query,
    });
    if (!result.ok) throw new Error(result.error);
    const consent = new URL(result.resume!, baseURL);
    expect(consent.pathname).toBe("/consent");
    expect(consent.searchParams.get("client_id")).toBe(setupResult.client.client_id);
    // Satisfied by the session just created, so the provider has dropped them.
    expect(consent.searchParams.has("max_age")).toBe(false);
    expect(consent.searchParams.get("prompt") ?? "").not.toContain("login");

    const callback = await approve(setupResult, result.resume!, result.cookies);
    expect(`${callback.origin}${callback.pathname}`).toBe(redirectURI);
    expect(callback.searchParams.get("code")).toBeTruthy();
    expect(callback.searchParams.get("state")).toBe("test-state");
  });

  it("would loop on prompt=login if it only replayed the authorize URL", async () => {
    // Why the sign-in goes through the provider's hooks: a session alone does not satisfy
    // prompt=login, so replaying the original request lands on the login page again.
    const setupResult = await setup();
    const query = await loginPageQuery(setupResult, { prompt: "login" });
    const result = await devSignIn(setupResult.auth, { userId: setupResult.persona.id });
    if (!result.ok) throw new Error(result.error);
    const replay = await setupResult.auth.handler(
      new Request(`${baseURL}/api/auth/oauth2/authorize?${query}`, {
        headers: { cookie: cookieHeader(result.cookies) },
      }),
    );
    expect(new URL(replay.headers.get("location")!, baseURL).pathname).toBe("/");
  });

  it.each([
    ["a widened scope", (params: URLSearchParams) => params.set("scope", "openid profile email")],
    [
      "another redirect URI",
      (params: URLSearchParams) => params.set("redirect_uri", "https://evil.example/cb"),
    ],
    ["prompt=login removed", (params: URLSearchParams) => params.delete("prompt")],
    ["a forged signature", (params: URLSearchParams) => params.set("sig", "AAAA")],
    ["an expired query", (params: URLSearchParams) => params.set("exp", "1")],
  ])("refuses a tampered query with %s, before creating a session", async (_, tamper) => {
    const setupResult = await setup();
    const params = new URLSearchParams(await loginPageQuery(setupResult, { prompt: "login" }));
    tamper(params);
    const result = await devSignIn(setupResult.auth, {
      userId: setupResult.persona.id,
      oauthQuery: params.toString(),
    });
    expect(result).toMatchObject({ ok: false, status: 400 });
    expect(await sessionsOf(setupResult, setupResult.persona.id)).toBe(0);
  });

  it("refuses an unknown user", async () => {
    const setupResult = await setup();
    expect(await devSignIn(setupResult.auth, { userId: "nobody" })).toMatchObject({
      ok: false,
      status: 404,
    });
  });
});
