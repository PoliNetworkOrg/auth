import { oauthProvider } from "@better-auth/oauth-provider";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { generateCodeChallenge } from "better-auth/oauth2";
import { jwt } from "better-auth/plugins/jwt";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import * as schema from "../db/schema";
import {
  clientIpOptions,
  oauthRateLimit,
  postgresRateLimitStorage,
  rateLimitedResponse,
} from "./rate-limit";

// A disposable, migrated database. Every key this suite writes starts with `rl-test:`.
const databaseURL = process.env.RATE_LIMIT_TEST_DATABASE_URL;
const PREFIX = "rl-test:";
const START = 1_900_000_000_000;

describe.skipIf(!databaseURL)("PostgreSQL rate limiting", () => {
  const pools: Pool[] = [];
  const pool = () => {
    const created = new Pool({ connectionString: databaseURL, max: 10 });
    pools.push(created);
    return created;
  };
  const main = pool();
  const clock = { now: START };
  const storageOn = (connection: Pool) =>
    postgresRateLimitStorage(drizzle(connection), { now: () => clock.now });
  const storage = storageOn(main);
  const row = async (key: string) =>
    (
      await main.query("select count, last_request from rate_limit where key = $1", [
        `${PREFIX}${key}`,
      ])
    ).rows[0] as { count: number; last_request: string } | undefined;
  const consume = (key: string, rule: { window: number; max: number }, at: number) => {
    clock.now = at;
    return storage.consume(`${PREFIX}${key}`, rule);
  };

  const cleanup = () => main.query("delete from rate_limit where key like $1", [`${PREFIX}%`]);
  beforeAll(cleanup);
  afterEach(cleanup);
  afterAll(async () => {
    await Promise.all(pools.map((created) => created.end()));
  });

  describe("fixed windows", () => {
    const rule = { window: 60, max: 30 };

    it("never refuses steady traffic below the limit", async () => {
      // Six requests a minute for ten minutes: the old storage refused the 31st.
      for (let index = 0; index < 60; index++)
        expect(await consume("steady", rule, START + index * 10_000)).toEqual({
          allowed: true,
          retryAfter: null,
        });
    });

    it("refuses a burst over the limit until the window ends", async () => {
      for (let index = 0; index < 30; index++)
        expect((await consume("burst", rule, START + index)).allowed).toBe(true);
      expect(await consume("burst", rule, START + 1_000)).toEqual({
        allowed: false,
        retryAfter: 59,
      });
      expect(await row("burst")).toEqual({ count: 31, last_request: String(START) });
    });

    it("ends the window exactly, however many refusals it saw", async () => {
      for (let index = 0; index < 30; index++) await consume("expiry", rule, START);
      for (const at of [START + 30_000, START + 59_000, START + 59_999])
        expect(await consume("expiry", rule, at)).toEqual({
          allowed: false,
          retryAfter: at === START + 30_000 ? 30 : 1,
        });
      // Refusals cap the count and leave the window start where it was.
      expect(await row("expiry")).toEqual({ count: 31, last_request: String(START) });
      expect(await consume("expiry", rule, START + 60_000)).toEqual({
        allowed: true,
        retryAfter: null,
      });
      expect(await row("expiry")).toEqual({ count: 1, last_request: String(START + 60_000) });
    });

    it("keeps keys and rules apart", async () => {
      const strict = { window: 10, max: 3 };
      for (let index = 0; index < 3; index++) await consume("a", strict, START);
      expect((await consume("a", strict, START)).allowed).toBe(false);
      expect((await consume("b", strict, START)).allowed).toBe(true);
    });

    it("uses the database clock when no test clock is given", async () => {
      const live = postgresRateLimitStorage(drizzle(main));
      const before = Date.now();
      expect(await live.consume(`${PREFIX}live`, rule)).toEqual({
        allowed: true,
        retryAfter: null,
      });
      const start = Number((await row("live"))?.last_request);
      expect(Math.abs(start - before)).toBeLessThan(5_000);
    });

    it("deletes rows whose windows ended long ago", async () => {
      // A fresh storage cleans up on its first request; clean the old row from an hour later.
      await consume("stale", rule, START);
      await postgresRateLimitStorage(drizzle(main), {
        now: () => START + 2 * 60 * 60 * 1000,
      }).consume(`${PREFIX}fresh`, rule);
      await vi.waitFor(async () => expect(await row("stale")).toBeUndefined());
      expect(await row("fresh")).toBeDefined();
    });
  });

  describe("concurrency across independent connections", () => {
    const rule = { window: 10, max: 3 };
    // Four storages on four pools stand in for four replicas.
    const replicas = Array.from({ length: 4 }, () => storageOn(pool()));
    const race = async (key: string, count: number, at: number) => {
      clock.now = at;
      const results = await Promise.all(
        Array.from({ length: count }, (_, index) =>
          replicas[index % replicas.length]!.consume(`${PREFIX}${key}`, rule),
        ),
      );
      return results.filter((result) => result.allowed).length;
    };

    it("admits exactly the limit on first use", async () => {
      expect(await race("first", 40, START)).toBe(3);
      expect((await row("first"))?.count).toBe(4);
    });

    it("admits exactly the remainder of a warmed window", async () => {
      expect((await consume("warm", rule, START)).allowed).toBe(true);
      expect(await race("warm", 40, START + 1_000)).toBe(2);
    });

    it("admits exactly the limit when the window rolls over", async () => {
      expect(await race("roll", 40, START)).toBe(3);
      expect(await race("roll", 40, START + 10_000)).toBe(3);
      expect(await row("roll")).toEqual({ count: 4, last_request: String(START + 10_000) });
    });
  });

  describe("through the Better Auth handler", () => {
    const baseURL = "https://auth.example.test";
    const redirectURI = "https://app.example.test/callback";
    const verifier = "rate-limit-test-verifier-with-at-least-43-characters";
    const password = "rate-limit-fixture-password";
    const logged: string[] = [];
    let authorizeURL: URL;
    let clientId: string;

    const fixture = (ipAddress: ReturnType<typeof clientIpOptions>, connection = main) => {
      const store = storageOn(connection);
      return betterAuth({
        baseURL,
        secret: "rate-limit-test-secret-with-at-least-32-characters",
        database: drizzleAdapter(drizzle(connection, { schema }), { provider: "pg", schema }),
        emailAndPassword: { enabled: true },
        advanced: { ipAddress },
        rateLimit: {
          enabled: true,
          customStorage: { consume: (key, rule) => store.consume(`${PREFIX}${key}`, rule) },
        },
        plugins: [
          jwt(),
          oauthProvider({
            loginPage: "/",
            consentPage: "/consent",
            scopes: ["openid", "profile", "email", "offline_access"],
            rateLimit: oauthRateLimit,
          }),
        ],
      });
    };
    const cloudflare = fixture(clientIpOptions({ AUTH_CLIENT_IP_HEADER: "cf-connecting-ip" }));
    const exactProxy = fixture(
      clientIpOptions({
        AUTH_CLIENT_IP_HEADER: "x-forwarded-for",
        AUTH_TRUSTED_PROXIES: ["10.42.0.8"],
      }),
    );
    let cookie = "";
    const email = `rl-test-${Date.now()}@example.test`;

    beforeAll(async () => {
      for (const method of ["log", "info", "warn", "error", "debug"] as const)
        vi.spyOn(console, method).mockImplementation((...args) => {
          logged.push(args.map(String).join(" "));
        });
      const signup = await cloudflare.api.signUpEmail({
        body: { email, name: "Rate limit fixture", password },
        asResponse: true,
      });
      expect(signup.status).toBe(200);
      cookie = signup.headers
        .getSetCookie()
        .map((value) => value.split(";")[0])
        .join("; ");
      const client = await cloudflare.api.adminCreateOAuthClient({
        headers: new Headers({ cookie }),
        body: {
          redirect_uris: [redirectURI],
          token_endpoint_auth_method: "none",
          grant_types: ["authorization_code", "refresh_token"],
          skip_consent: true,
        },
      });
      clientId = client.client_id;
      authorizeURL = new URL("/api/auth/oauth2/authorize", baseURL);
      authorizeURL.search = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectURI,
        response_type: "code",
        scope: "openid profile email offline_access",
        state: "rate-limit-state",
        nonce: "rate-limit-nonce",
        code_challenge: await generateCodeChallenge(verifier),
        code_challenge_method: "S256",
      }).toString();
    });

    afterAll(async () => {
      vi.restoreAllMocks();
      await main.query("delete from oauth_client where client_id = $1", [clientId]);
      await main.query(`delete from "user" where email = $1`, [email]);
      const secrets = [password, verifier, cookie.split("=")[1] ?? cookie];
      for (const line of logged) for (const secret of secrets) expect(line).not.toContain(secret);
    });

    const authorize = (auth: typeof cloudflare, headers: Record<string, string>) =>
      auth.handler(new Request(authorizeURL, { headers: { cookie, ...headers } }));

    it("gives each caller behind a multi-hop chain its own quota", async () => {
      clock.now = START;
      for (const [auth, header] of [
        [cloudflare, (ip: string) => ({ "cf-connecting-ip": ip })],
        [exactProxy, () => ({})],
      ] as const) {
        await cleanup();
        for (let index = 1; index <= 31; index++) {
          const ip = `192.0.2.${index}`;
          const response = await authorize(auth, {
            "x-forwarded-for": `${ip}, 10.42.0.8`,
            ...header(ip),
          });
          expect(response.status).toBe(302);
        }
        const keys = await main.query("select key from rate_limit where key like $1", [
          `${PREFIX}%/oauth2/authorize`,
        ]);
        expect(keys.rowCount).toBe(31);
      }
    });

    it("keeps one caller's quota however it rewrites x-forwarded-for", async () => {
      clock.now = START;
      for (const [auth, header] of [
        [cloudflare, { "cf-connecting-ip": "198.51.100.7" }],
        [exactProxy, {}],
      ] as const) {
        await cleanup();
        const statuses: number[] = [];
        for (let index = 1; index <= 31; index++)
          statuses.push(
            (
              await authorize(auth, {
                "x-forwarded-for": `203.0.113.${index}, 198.51.100.7, 10.42.0.8`,
                ...header,
              })
            ).status,
          );
        expect(statuses.slice(0, 30).every((status) => status === 302)).toBe(true);
        expect(statuses[30]).toBe(429);
      }
    });

    it("never refuses steady authorization traffic below the limit", async () => {
      for (let index = 0; index < 31; index++) {
        clock.now = START + index * 10_000;
        expect((await authorize(cloudflare, { "cf-connecting-ip": "198.51.100.70" })).status).toBe(
          302,
        );
      }
    });

    it("bounds server token traffic at the documented budget", async () => {
      clock.now = START;
      const statuses: number[] = [];
      for (let index = 1; index <= oauthRateLimit.token.max + 1; index++) {
        // Browsers authorize from their own addresses; the server exchanges without one.
        const authorization = await authorize(cloudflare, {
          "cf-connecting-ip": `198.51.100.${index}`,
        });
        expect(authorization.status).toBe(302);
        const code = new URL(authorization.headers.get("location")!).searchParams.get("code")!;
        const request = new Request(new URL("/api/auth/oauth2/token", baseURL), {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            grant_type: "authorization_code",
            client_id: clientId,
            code,
            redirect_uri: redirectURI,
            code_verifier: verifier,
          }),
        });
        const response = await cloudflare.handler(request);
        statuses.push(response.status);
        if (response.status !== 429) continue;
        const normalized = rateLimitedResponse(request, response);
        const body = await normalized.text();
        expect(normalized.headers.get("retry-after")).toBe("60");
        expect(normalized.headers.get("cache-control")).toBe("no-store");
        for (const secret of [code, verifier, clientId]) expect(body).not.toContain(secret);
      }
      expect(statuses.filter((status) => status === 200)).toHaveLength(oauthRateLimit.token.max);
      expect(statuses.at(-1)).toBe(429);
    });

    it("keeps the strict sign-in limit", async () => {
      clock.now = START;
      const statuses: number[] = [];
      for (let index = 0; index < 4; index++)
        statuses.push(
          (
            await cloudflare.handler(
              new Request(new URL("/api/auth/sign-in/email", baseURL), {
                method: "POST",
                headers: {
                  "content-type": "application/json",
                  origin: baseURL,
                  "cf-connecting-ip": "198.51.100.200",
                },
                body: JSON.stringify({ email, password: "wrong-password-guess" }),
              }),
            )
          ).status,
        );
      expect(statuses.slice(0, 3)).not.toContain(429);
      expect(statuses[3]).toBe(429);
    });

    it("admits exactly the sign-in limit to a concurrent burst on four replicas", async () => {
      clock.now = START;
      const replicas = [
        cloudflare,
        ...Array.from({ length: 3 }, () =>
          fixture(clientIpOptions({ AUTH_CLIENT_IP_HEADER: "cf-connecting-ip" }), pool()),
        ),
      ];
      const signIn = (index: number) =>
        replicas[index % replicas.length]!.handler(
          new Request(new URL("/api/auth/sign-in/email", baseURL), {
            method: "POST",
            headers: {
              "content-type": "application/json",
              origin: baseURL,
              "cf-connecting-ip": "198.51.100.201",
            },
            body: JSON.stringify({ email, password: "wrong-password-guess" }),
          }),
        );
      expect((await signIn(0)).status).not.toBe(429);
      const responses = await Promise.all(Array.from({ length: 40 }, (_, index) => signIn(index)));
      const statuses = responses.map((response) => response.status);
      expect(statuses.filter((status) => status !== 429)).toHaveLength(2);
    });
  });
});
