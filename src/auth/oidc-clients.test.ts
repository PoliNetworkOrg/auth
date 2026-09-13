import { describe, expect, it } from "vite-plus/test";
import {
  emptyClientDraft,
  grantTypesForScopes,
  hasDraftErrors,
  normalizeClientDraft,
  validateClientDraft,
  validateRedirectUri,
} from "./oidc-clients";

describe("redirect URI rules", () => {
  it("requires https on a public host for web apps", () => {
    expect(validateRedirectUri("https://app.polinetwork.org/callback", "web")).toBeNull();
    expect(validateRedirectUri("http://app.polinetwork.org/callback", "web")).toMatch(/https/);
    expect(validateRedirectUri("https://localhost:3000/callback", "web")).toMatch(/localhost/);
    expect(validateRedirectUri("http://localhost:3000/callback", "web")).toMatch(/https/);
  });

  it("allows loopback http and reverse-domain schemes for native apps", () => {
    expect(validateRedirectUri("http://localhost:3000/callback", "native")).toBeNull();
    expect(validateRedirectUri("http://127.0.0.1:8080/cb", "native")).toBeNull();
    expect(validateRedirectUri("http://[::1]:8080/cb", "native")).toBeNull();
    expect(validateRedirectUri("http://192.168.1.2/cb", "native")).toMatch(/localhost/);
    expect(validateRedirectUri("https://localhost/cb", "native")).toMatch(/http, not https/);
    expect(validateRedirectUri("org.polinetwork.app:/callback", "native")).toBeNull();
    expect(validateRedirectUri("myapp://callback", "native")).toMatch(/reverse-domain/);
    expect(validateRedirectUri("javascript:alert(1)", "native")).toMatch(/not allowed/);
  });

  it("rejects fragments, credentials, and relative paths everywhere", () => {
    expect(validateRedirectUri("https://app.example/cb#x", "web")).toMatch(/fragment/);
    expect(validateRedirectUri("https://user:pw@app.example/cb", "web")).toMatch(/credentials/);
    expect(validateRedirectUri("/callback", "native")).toMatch(/absolute/);
    expect(validateRedirectUri("   ", "web")).toMatch(/Enter/);
  });
});

describe("client draft validation", () => {
  it("accepts a minimal web application", () => {
    const draft = { ...emptyClientDraft(), name: "Polimi Bot", redirectUris: ["https://a.b/cb"] };
    expect(hasDraftErrors(validateClientDraft(draft))).toBe(false);
  });

  it("reports per-row redirect problems and duplicates", () => {
    const draft = {
      ...emptyClientDraft(),
      name: "App",
      redirectUris: ["https://a.b/cb", "https://a.b/cb", "http://a.b/cb"],
    };
    const errors = validateClientDraft(draft);
    expect(errors.redirectUriItems).toEqual([
      null,
      expect.stringMatching(/twice/),
      expect.any(String),
    ]);
  });

  it("requires a name, at least one redirect URI, and the openid scope", () => {
    const errors = validateClientDraft({ ...emptyClientDraft(), redirectUris: [""], scopes: [] });
    expect(errors.name).toBeDefined();
    expect(errors.redirectUris).toBeDefined();
    expect(errors.scopes).toMatch(/openid/);
  });

  it("validates optional https links and contact emails", () => {
    const errors = validateClientDraft({
      ...emptyClientDraft(),
      name: "App",
      redirectUris: ["https://a.b/cb"],
      uri: "http://insecure.example",
      logo: "not a url",
      contacts: ["team@polinetwork.org", "nope"],
    });
    expect(errors.uri).toMatch(/https/);
    expect(errors.logo).toBeDefined();
    expect(errors.contactItems).toEqual([null, expect.any(String)]);
  });

  it("normalizes whitespace, drops empty rows, and orders scopes", () => {
    const normalized = normalizeClientDraft({
      ...emptyClientDraft(),
      name: "  App  ",
      redirectUris: [" https://a.b/cb ", ""],
      contacts: ["", " x@y.z "],
      scopes: ["offline_access", "openid"],
    });
    expect(normalized).toMatchObject({
      name: "App",
      redirectUris: ["https://a.b/cb"],
      contacts: ["x@y.z"],
      scopes: ["openid", "offline_access"],
    });
    expect(grantTypesForScopes(normalized.scopes)).toEqual(["authorization_code", "refresh_token"]);
    expect(grantTypesForScopes(["openid"])).toEqual(["authorization_code"]);
  });
});
