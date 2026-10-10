import { getIP } from "better-auth/api";
import { describe, expect, it } from "vite-plus/test";
import { validateSecurityConfiguration as validate } from "../../scripts/security-config.mjs";
import { clientIpOptions, oauthRateLimit, rateLimitedResponse } from "./rate-limit";

const cloudflare = clientIpOptions({ AUTH_CLIENT_IP_HEADER: "cf-connecting-ip" });
const exactProxy = clientIpOptions({
  AUTH_CLIENT_IP_HEADER: "x-forwarded-for",
  AUTH_TRUSTED_PROXIES: ["10.42.0.8"],
});
const ipOf = (ipAddress: ReturnType<typeof clientIpOptions>, headers: Record<string, string>) =>
  getIP(new Headers(headers), { advanced: { ipAddress } });
// Outside production Better Auth substitutes this for an unresolvable address. Production uses
// one shared bucket instead; either way the caller cannot pick a bucket of its own.
const FALLBACK = "127.0.0.1";

describe("client address", () => {
  it("maps the configuration onto Better Auth's options", () => {
    expect(cloudflare).toEqual({ ipAddressHeaders: ["cf-connecting-ip"] });
    expect(exactProxy).toEqual({
      ipAddressHeaders: ["x-forwarded-for"],
      trustedProxies: ["10.42.0.8"],
    });
    expect(clientIpOptions({ AUTH_TRUSTED_PROXIES: [] })).toEqual({});
  });

  it("separates callers behind a multi-hop chain", () => {
    const addresses = Array.from({ length: 31 }, (_, index) => `192.0.2.${index + 1}`);
    for (const options of [cloudflare, exactProxy])
      expect(
        new Set(
          addresses.map((ip) =>
            ipOf(options, { "cf-connecting-ip": ip, "x-forwarded-for": `${ip}, 10.42.0.8` }),
          ),
        ).size,
      ).toBe(31);
  });

  it("ignores forwarded addresses a client adds itself", () => {
    for (const forged of ["198.51.100.1", "198.51.100.2, 203.0.113.9"]) {
      expect(
        ipOf(cloudflare, {
          "cf-connecting-ip": "192.0.2.7",
          "x-forwarded-for": `${forged}, 192.0.2.7, 10.42.0.8`,
        }),
      ).toBe("192.0.2.7");
      expect(ipOf(exactProxy, { "x-forwarded-for": `${forged}, 192.0.2.7, 10.42.0.8` })).toBe(
        "192.0.2.7",
      );
    }
  });

  it("never turns a malformed or untrusted value into a bucket of its own", () => {
    for (const value of ["", "not-an-ip", "192.0.2.1, 192.0.2.2", "192.0.2.1:443", "999.1.1.1"])
      expect(ipOf(cloudflare, { "cf-connecting-ip": value })).toBe(FALLBACK);
    // A chain ending in an unknown hop names that hop, the closest untrusted sender.
    expect(ipOf(exactProxy, { "x-forwarded-for": "192.0.2.7, 10.99.0.1" })).toBe("10.99.0.1");
    expect(ipOf(exactProxy, { "x-forwarded-for": "garbage, 10.42.0.8" })).toBe(FALLBACK);
    expect(ipOf(exactProxy, { "x-forwarded-for": "10.42.0.8" })).toBe(FALLBACK);
    expect(ipOf(cloudflare, { "x-forwarded-for": "192.0.2.7" })).toBe(FALLBACK);
  });

  it("groups an IPv6 /64 into one bucket", () => {
    expect(ipOf(cloudflare, { "cf-connecting-ip": "2001:db8:1:2::1" })).toBe(
      ipOf(cloudflare, { "cf-connecting-ip": "2001:db8:1:2:ffff::9" }),
    );
  });
});

describe("client address configuration", () => {
  const base = { BETTER_AUTH_SECRET: "x".repeat(40), IDP_ADMIN_USER_IDS: "root" };

  it("requires a client address header in production", () => {
    expect(() => validate({ ...base, NODE_ENV: "production" })).toThrow(/AUTH_CLIENT_IP_HEADER/);
    expect(() =>
      validate({ ...base, NODE_ENV: "production", AUTH_CLIENT_IP_HEADER: "cf-connecting-ip" }),
    ).not.toThrow();
    expect(() => validate(base)).not.toThrow();
  });

  it.each(["x-client-ip", "X-Forwarded-For", "forwarded"])("refuses header %j", (header) => {
    expect(() => validate({ ...base, AUTH_CLIENT_IP_HEADER: header })).toThrow();
  });

  it.each(["0.0.0.0/0", "::/0", "10.0.0.0/33", "proxy", "10.42.0.8,"])(
    "refuses trusted proxies %j",
    (proxies) => {
      expect(() =>
        validate({
          ...base,
          AUTH_CLIENT_IP_HEADER: "x-forwarded-for",
          AUTH_TRUSTED_PROXIES: proxies,
        }),
      ).toThrow();
    },
  );

  it("accepts exact proxies only with x-forwarded-for", () => {
    const proxies = { AUTH_TRUSTED_PROXIES: "10.42.0.8, 10.43.0.0/24, fd00::1" };
    expect(() =>
      validate({ ...base, ...proxies, AUTH_CLIENT_IP_HEADER: "x-forwarded-for" }),
    ).not.toThrow();
    expect(() =>
      validate({ ...base, ...proxies, AUTH_CLIENT_IP_HEADER: "cf-connecting-ip" }),
    ).toThrow();
  });
});

describe("token budget", () => {
  it("stays bounded", () => {
    expect(oauthRateLimit.token).toEqual({ window: 60, max: 60 });
  });
});

describe("rate-limited response", () => {
  const limited = () =>
    new Response(JSON.stringify({ message: "Too many requests. Please try again later." }), {
      status: 429,
      headers: { "x-retry-after": "42" },
    });

  it("gives API callers JSON with a standard delay and no caching", async () => {
    const response = rateLimitedResponse(
      new Request("https://auth.example.test/api/auth/oauth2/token", { method: "POST" }),
      limited(),
    );
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("42");
    expect(response.headers.get("x-retry-after")).toBe("42");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("content-type")).toBe("application/json");
    expect(await response.json()).toEqual({
      code: "TOO_MANY_REQUESTS",
      message: "Too many requests. Please try again later.",
      retryAfter: 42,
    });
  });

  it("shows a navigating browser a page without automatic retries", async () => {
    const response = rateLimitedResponse(
      new Request("https://auth.example.test/api/auth/oauth2/authorize?client_id=x&state=s", {
        headers: { "sec-fetch-mode": "navigate", accept: "text/html" },
      }),
      limited(),
    );
    const html = await response.text();
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("42");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("content-type")).toMatch(/^text\/html/);
    expect(html).toContain("Wait 42 seconds");
    expect(html).not.toMatch(/<script|http-equiv|client_id|state=/i);
  });

  it("falls back to a minute when the delay is missing or malformed", () => {
    for (const value of [null, "", "soon", "-3", "0"]) {
      const headers = new Headers(value === null ? {} : { "x-retry-after": value });
      const response = rateLimitedResponse(
        new Request("https://auth.example.test/api/auth/sign-in/social", { method: "POST" }),
        new Response(null, { status: 429, headers }),
      );
      expect(response.headers.get("retry-after")).toBe("60");
    }
  });
});
