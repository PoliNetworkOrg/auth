import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";

const BASE = "http://localhost:35440";

vi.mock("../env", () => {
  const url = new URL(
    process.env.RBAC_TEST_DATABASE_URL ??
      "postgresql://postgres:test@localhost:55439/auth_security",
  );
  return {
    env: {
      DB_HOST: url.hostname,
      DB_PORT: Number(url.port),
      DB_USER: url.username,
      DB_PASS: url.password,
      DB_NAME: url.pathname.slice(1),
      BETTER_AUTH_URL: "http://localhost:35440",
      BETTER_AUTH_SECRET: "test-only-secret-with-at-least-32-characters",
      IDP_ADMIN_USER_IDS: ["sign-in-errors-root"],
      PN_ENTRA_TENANT_ID: "11111111-1111-4111-8111-111111111111",
      PN_ENTRA_MEMBER_GROUP_ID: "soci",
      // Each sign-in comes from its own address, so the sign-in rate limit doesn't join them up.
      AUTH_CLIENT_IP_HEADER: "x-real-ip",
    },
  };
});
vi.mock("./membership", () => ({
  checkEntraGroupMember: vi.fn().mockResolvedValue(false),
  listEntraGroupMembers: vi.fn().mockResolvedValue(null),
}));

/** What the test provider does with the next account it's asked about. */
const next = vi.hoisted(() => ({ outcome: "refuse" as "refuse" | "fail" }));

// The one test provider replaces the real ones: no network, and its account check goes through
// the real `accountOrNull`, the same path Google, PoliNetwork APS and Telegram take.
vi.mock("./providers", async (importOriginal) => {
  const original = await importOriginal<typeof import("./providers")>();
  const { AccountRefused } = await import("./provider-errors");
  const { PROVIDER_ERROR_CODES } = await import("./sign-in-errors");
  return {
    ...original,
    providers: [
      {
        providerId: "test-idp",
        clientId: "test-idp-client",
        clientSecret: "test-idp-secret",
        authorizationUrl: "https://idp.example.test/authorize",
        tokenUrl: "https://idp.example.test/token",
        pkce: true,
        getToken: async () => ({ accessToken: "test-access-token", tokenType: "Bearer" }),
        getUserInfo: () =>
          original.accountOrNull("test-idp", async () => {
            if (next.outcome === "refuse")
              throw new AccountRefused(PROVIDER_ERROR_CODES.entraGuest, "Guest");
            throw new Error("JWKS unreachable");
          }),
      },
    ],
  };
});

/**
 * A failed provider callback, end to end through Better Auth: an authorization request, the
 * sign-in it starts, and the provider's callback. It covers what unit tests can't: that the
 * reason a provider records is still there when the `after` hook routes the callback, which
 * relies on Better Auth keeping one OAuth state object per request.
 */
describe.skipIf(!process.env.RBAC_TEST_DATABASE_URL)("sign-in errors with PostgreSQL", () => {
  const pool = new Pool({ connectionString: process.env.RBAC_TEST_DATABASE_URL });
  const client = `sign-in-errors-${randomUUID().slice(0, 8)}`;
  const redirectUri = "https://app.example.test/auth/callback";

  async function handler() {
    const { auth } = await import("./index");
    return auth.handler;
  }

  /** Cookies the browser keeps between the steps of one sign-in. */
  function cookieJar() {
    const cookies = new Map<string, string>();
    return {
      header: () => [...cookies].map(([name, value]) => `${name}=${value}`).join("; "),
      keep(response: Response) {
        for (const cookie of response.headers.getSetCookie()) {
          const [pair] = cookie.split(";");
          const at = pair.indexOf("=");
          cookies.set(pair.slice(0, at), pair.slice(at + 1));
        }
      },
    };
  }

  /** Starts a sign-in with the test provider and returns its OAuth `state` and cookies. */
  async function startSignIn({ inApplication }: { inApplication: boolean }) {
    const handle = await handler();
    const jar = cookieJar();
    const ip = `198.51.100.${Math.floor(Math.random() * 250) + 1}`;
    let oauthQuery: string | undefined;
    if (inApplication) {
      const authorize = new URL(`${BASE}/api/auth/oauth2/authorize`);
      authorize.search = new URLSearchParams({
        response_type: "code",
        client_id: client,
        redirect_uri: redirectUri,
        scope: "openid",
        state: "app-state",
        code_challenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
        code_challenge_method: "S256",
      }).toString();
      const response = await handle(new Request(authorize, { headers: { "x-real-ip": ip } }));
      jar.keep(response);
      const login = new URL(response.headers.get("location") ?? "", BASE);
      expect(login.searchParams.has("sig")).toBe(true);
      oauthQuery = login.searchParams.toString();
    }
    const response = await handle(
      new Request(`${BASE}/api/auth/sign-in/social`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: BASE,
          "sec-fetch-site": "same-origin",
          "x-real-ip": ip,
          cookie: jar.header(),
        },
        body: JSON.stringify({ provider: "test-idp", callbackURL: "/", oauth_query: oauthQuery }),
      }),
    );
    jar.keep(response);
    const { url } = (await response.json()) as { url: string };
    const state = new URL(url).searchParams.get("state");
    expect(state).toBeTruthy();
    return { state: state!, jar, ip };
  }

  /** Comes back from the provider with `params`, and returns where the callback sends the browser. */
  async function callback(
    { state, jar, ip }: Awaited<ReturnType<typeof startSignIn>>,
    params: Record<string, string>,
  ) {
    const handle = await handler();
    const url = new URL(`${BASE}/api/auth/callback/test-idp`);
    url.search = new URLSearchParams({ state, ...params }).toString();
    const response = await handle(
      new Request(url, { headers: { cookie: jar.header(), "x-real-ip": ip } }),
    );
    expect(response.status).toBe(302);
    return new URL(response.headers.get("location") ?? "", BASE);
  }

  beforeAll(async () => {
    await pool.query(
      `INSERT INTO oauth_client
         (id, client_id, name, redirect_uris, reference_id, token_endpoint_auth_method,
          grant_types, response_types, scopes, skip_consent, require_pkce, created_at, updated_at)
       VALUES ($1, $1, 'Test App', ARRAY[$2], 'polinetwork', 'none', ARRAY['authorization_code'],
               ARRAY['code'], ARRAY['openid'], true, true, now(), now())`,
      [client, redirectUri],
    );
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM oauth_client WHERE client_id = $1`, [client]);
    await pool.end();
    const { db } = await import("../db/index");
    await db.$client.end();
  });

  it("explains a refused account on /error, with the application to go back to", async () => {
    next.outcome = "refuse";
    const location = await callback(await startSignIn({ inApplication: true }), { code: "c" });
    expect(location.pathname).toBe("/error");
    expect(location.searchParams.get("error")).toBe("pn_entra_guest");
    expect(location.searchParams.get("provider")).toBe("test-idp");
    expect(location.searchParams.get("app")).toBeTruthy();
  });

  it("reports a provider failure as one, not as a refusal", async () => {
    next.outcome = "fail";
    const location = await callback(await startSignIn({ inApplication: true }), { code: "c" });
    expect(location.pathname).toBe("/error");
    expect(location.searchParams.get("error")).toBe("provider_failed");
  });

  it("sends a cancel inside an application straight back to it", async () => {
    const location = await callback(await startSignIn({ inApplication: true }), {
      error: "access_denied",
    });
    expect(`${location.origin}${location.pathname}`).toBe(redirectUri);
    expect(location.searchParams.get("error")).toBe("access_denied");
    expect(location.searchParams.get("state")).toBe("app-state");
    expect(location.searchParams.get("iss")).toBe(`${BASE}/api/auth`);
  });

  it("shows a refusal outside an application without one", async () => {
    next.outcome = "refuse";
    const location = await callback(await startSignIn({ inApplication: false }), { code: "c" });
    expect(location.pathname).toBe("/error");
    expect(location.searchParams.get("error")).toBe("pn_entra_guest");
    expect(location.searchParams.has("app")).toBe(false);
  });
});
