import { makeSignature } from "better-auth/crypto";
import { describe, expect, it } from "vite-plus/test";
import {
  APP_CONTEXT_TTL_SECONDS,
  readAppContext,
  signAppContext,
  verifySignedQueryIgnoringExpiry,
} from "./sign-in-return";

const secret = "test-secret-that-is-long-enough-for-hmac";

/** Signs a query the way the provider plugin does (`signParams` in @better-auth/oauth-provider). */
async function signLikeThePlugin(params: Record<string, string>, key = secret) {
  const query = new URLSearchParams(params);
  const names = [...new Set([...query.keys(), "ba_param"])].sort();
  for (const name of names) query.append("ba_param", name);
  const sorted = new URLSearchParams(
    [...query].sort(([a, va], [b, vb]) =>
      a < b ? -1 : a > b ? 1 : va < vb ? -1 : va > vb ? 1 : 0,
    ),
  );
  query.append("sig", await makeSignature(sorted.toString(), key));
  return query.toString();
}

const request = {
  response_type: "code",
  client_id: "dashboard",
  redirect_uri: "https://admin.polinetwork.org/auth/callback",
  state: "s-123",
  scope: "openid profile",
  code_challenge: "abc",
  code_challenge_method: "S256",
};

describe("verifySignedQueryIgnoringExpiry", () => {
  it("accepts an expired query Auth signed, and returns its authorization request", async () => {
    const search = await signLikeThePlugin({ ...request, exp: "1000", ba_iat: "999000" });
    const verified = await verifySignedQueryIgnoringExpiry(`?${search}`, secret);
    expect(verified && Object.fromEntries(verified)).toEqual(request);
  });

  it("accepts the signature forms the plugin accepts", async () => {
    const search = await signLikeThePlugin({ ...request, exp: "1000" });
    const sig = new URLSearchParams(search).get("sig")!;
    const query = new URLSearchParams(search);
    query.set("sig", sig.replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_"));
    expect(await verifySignedQueryIgnoringExpiry(query.toString(), secret)).not.toBeNull();
    // A `+` written unescaped in the URL arrives as a space.
    const raw = search.replace(/sig=[^&]*/, `sig=${sig}`);
    expect(await verifySignedQueryIgnoringExpiry(raw, secret)).not.toBeNull();
  });

  it("ignores parameters added outside the signature", async () => {
    const search = await signLikeThePlugin({ ...request, exp: "1000" });
    const verified = await verifySignedQueryIgnoringExpiry(`${search}&utm_source=mail`, secret);
    expect(verified?.has("utm_source")).toBe(false);
  });

  it("refuses a changed redirect URI, another secret, or a missing or repeated signature", async () => {
    const search = await signLikeThePlugin({ ...request, exp: "1000" });
    const tampered = search.replace(
      encodeURIComponent(request.redirect_uri),
      encodeURIComponent("https://evil.example/cb"),
    );
    expect(tampered).not.toBe(search);
    expect(await verifySignedQueryIgnoringExpiry(tampered, secret)).toBeNull();
    expect(
      await verifySignedQueryIgnoringExpiry(search, "another-secret-entirely-xxxxxx"),
    ).toBeNull();
    expect(
      await verifySignedQueryIgnoringExpiry(search.replace(/&sig=[^&]*/, ""), secret),
    ).toBeNull();
    const sig = new URLSearchParams(search).get("sig")!;
    expect(
      await verifySignedQueryIgnoringExpiry(`${search}&sig=${encodeURIComponent(sig)}`, secret),
    ).toBeNull();
    expect(await verifySignedQueryIgnoringExpiry("client_id=dashboard", secret)).toBeNull();
  });
});

describe("app context", () => {
  const query = new URLSearchParams(request);

  it("round-trips the authorization request", async () => {
    const token = await signAppContext(query, secret);
    expect(token).toMatch(/^[\w-]+\.[\w-]+$/);
    expect((await readAppContext(token, secret))?.toString()).toBe(query.toString());
  });

  it("expires after an hour", async () => {
    const now = Date.now();
    const token = await signAppContext(query, secret, now);
    expect(
      await readAppContext(token, secret, now + (APP_CONTEXT_TTL_SECONDS - 5) * 1000),
    ).not.toBeNull();
    expect(
      await readAppContext(token, secret, now + (APP_CONTEXT_TTL_SECONDS + 5) * 1000),
    ).toBeNull();
  });

  it("refuses a changed payload, another secret and junk", async () => {
    const token = await signAppContext(query, secret);
    const [, sig] = token.split(".");
    const forged = Buffer.from(
      JSON.stringify({ q: "client_id=dashboard&redirect_uri=https://evil.example/", exp: 9e9 }),
    ).toString("base64url");
    expect(await readAppContext(`${forged}.${sig}`, secret)).toBeNull();
    expect(await readAppContext(token, "another-secret-entirely-xxxxxx")).toBeNull();
    for (const junk of ["", ".", "a.b", `${token}.x`, "not-a-token"])
      expect(await readAppContext(junk, secret), junk).toBeNull();
  });
});
