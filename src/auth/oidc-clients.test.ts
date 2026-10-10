import { describe, expect, it } from "vite-plus/test";
import { CLIENT_PRESETS } from "./client-presets";
import {
  clientRegistration,
  draftFromClient,
  emptyClientDraft,
  hasDraftErrors,
  isRestrictedClient,
  isRestrictedDraft,
  normalizeClientDraft,
  type OidcClientDraft,
  type OidcClientSummary,
  parsePublicJwks,
  validateClientDraft,
  validateRedirectUri,
} from "./oidc-clients";

const withApi = { apiAccess: true };
const withoutApi = { apiAccess: false };
const publicKey = { kty: "OKP", crv: "Ed25519", x: "11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo" };

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
    expect(hasDraftErrors(validateClientDraft(draft, withoutApi))).toBe(false);
  });

  it("reports per-row redirect problems and duplicates", () => {
    const draft = {
      ...emptyClientDraft(),
      name: "App",
      redirectUris: ["https://a.b/cb", "https://a.b/cb", "http://a.b/cb"],
    };
    const errors = validateClientDraft(draft, withoutApi);
    expect(errors.redirectUriItems).toEqual([
      null,
      expect.stringMatching(/twice/),
      expect.any(String),
    ]);
  });

  it("requires a name, at least one redirect URI, and the openid scope", () => {
    const errors = validateClientDraft(
      { ...emptyClientDraft(), redirectUris: [""], scopes: [] },
      withoutApi,
    );
    expect(errors.name).toBeDefined();
    expect(errors.redirectUris).toBeDefined();
    expect(errors.scopes).toMatch(/openid/);
  });

  it("validates optional https links and contact emails", () => {
    const errors = validateClientDraft(
      {
        ...emptyClientDraft(),
        name: "App",
        redirectUris: ["https://a.b/cb"],
        uri: "http://insecure.example",
        logo: "not a url",
        contacts: ["team@polinetwork.org", "nope"],
      },
      withoutApi,
    );
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
    expect(clientRegistration(normalized).grantTypes).toEqual([
      "authorization_code",
      "refresh_token",
    ]);
    expect(clientRegistration(emptyClientDraft()).grantTypes).toEqual(["authorization_code"]);
  });
});

function draft(overrides: Partial<OidcClientDraft>): OidcClientDraft {
  return { ...emptyClientDraft(), name: "App", redirectUris: ["https://a.b/cb"], ...overrides };
}

describe("client credentials", () => {
  it("requires a public JWKS for a private-key client and refuses private keys", () => {
    expect(validateClientDraft(draft({ credential: "private-key" }), withoutApi).jwks).toMatch(
      /Paste/,
    );
    expect(
      validateClientDraft(
        draft({ credential: "private-key", jwks: JSON.stringify({ keys: [publicKey] }) }),
        withoutApi,
      ),
    ).toEqual({});
    expect(() =>
      parsePublicJwks(JSON.stringify({ keys: [{ ...publicKey, d: "secret" }] })),
    ).toThrow(/public keys only/);
    expect(() => parsePublicJwks("{")).toThrow(/valid public JWKS/);
    expect(() => parsePublicJwks(JSON.stringify({ keys: [] }))).toThrow(/between one/);
  });

  it("drops a typed JWKS once the client stops using a private key", () => {
    expect(normalizeClientDraft(draft({ credential: "secret", jwks: "{}" })).jwks).toBe("");
  });

  it("lets a private-key client sign people in without API access", () => {
    const sso = normalizeClientDraft(
      draft({ credential: "private-key", jwks: JSON.stringify({ keys: [publicKey] }) }),
    );
    expect(isRestrictedDraft(sso)).toBe(false);
    expect(clientRegistration(sso)).toMatchObject({
      grantTypes: ["authorization_code"],
      scopes: ["openid", "profile"],
      clientCredentialsScopes: [],
      resources: [],
    });
  });
});

describe("tokens and API access", () => {
  it("needs at least one way to obtain tokens", () => {
    expect(validateClientDraft(draft({ signIn: false }), withApi).grants).toMatch(/Choose/);
  });

  it("refuses service access and API scopes where the server has no resources", () => {
    const errors = validateClientDraft(
      draft({
        serviceAccess: true,
        serviceScopes: ["backend:public:read"],
        resources: ["backend"],
      }),
      withoutApi,
    );
    expect(errors.grants).toMatch(/not configured/);
    expect(errors.apiScopes).toMatch(/not configured/);
  });

  it("refuses service access to public clients and without API scopes", () => {
    expect(
      validateClientDraft(draft({ credential: "public", serviceAccess: true }), withApi).grants,
    ).toMatch(/Public clients/);
    expect(validateClientDraft(draft({ serviceAccess: true }), withApi).apiScopes).toMatch(
      /API scopes/,
    );
  });

  it("requires the resource each API scope belongs to", () => {
    expect(
      validateClientDraft(draft({ apiScopes: ["idp:access:read"] }), withApi).apiScopes,
    ).toMatch(/Link/);
    expect(
      validateClientDraft(
        draft({ apiScopes: ["idp:access:read"], resources: ["internal"] }),
        withApi,
      ),
    ).toEqual({});
  });

  it("ignores redirect URIs and sign-in scopes of a client that only acts as itself", () => {
    const service = normalizeClientDraft(
      draft({
        signIn: false,
        serviceAccess: true,
        redirectUris: ["not a uri"],
        scopes: [],
        serviceScopes: ["backend:public:read"],
        resources: ["backend"],
      }),
    );
    expect(validateClientDraft(service, withApi)).toEqual({});
    expect(clientRegistration(service)).toMatchObject({
      redirectUris: [],
      scopes: ["backend:public:read"],
    });
  });

  it("reserves API scopes, service access, and resource links to Master Admin", () => {
    const empty = {
      grantTypes: ["authorization_code"],
      scopes: ["openid"],
      clientCredentialsScopes: [],
    };
    expect(isRestrictedClient(empty)).toBe(false);
    expect(isRestrictedClient({ ...empty, grantTypes: ["client_credentials"] })).toBe(true);
    expect(isRestrictedClient({ ...empty, scopes: ["openid", "backend:future"] })).toBe(true);
    expect(isRestrictedClient({ ...empty, resourceIds: ["https://api.example"] })).toBe(true);
    expect(isRestrictedDraft(draft({ resources: ["backend"] }))).toBe(true);
  });
});

describe("presets", () => {
  // The reviewed Phase 1 registrations (RFC §9), which the presets must still produce.
  const reviewed = {
    "telegram-bot": {
      grantTypes: ["client_credentials"],
      scopes:
        "backend:tg:read backend:tg:ingest backend:tg:groups:sync backend:tg:audit backend:tg:act-as backend:tg:events",
      clientCredentials: true,
      resources: ["backend"],
    },
    website: {
      grantTypes: ["client_credentials"],
      scopes: "backend:public:read",
      clientCredentials: true,
      resources: ["backend"],
    },
    "admin-dashboard": {
      grantTypes: ["authorization_code", "refresh_token"],
      scopes: "openid profile email offline_access backend:admin",
      clientCredentials: false,
      resources: ["backend"],
    },
    backend: {
      grantTypes: ["client_credentials"],
      scopes: "idp:access:read",
      clientCredentials: true,
      resources: ["internal"],
    },
  } as const;

  it.each(CLIENT_PRESETS)("registers $name as reviewed", (preset) => {
    const expected = reviewed[preset.id as keyof typeof reviewed];
    const filled = normalizeClientDraft({
      ...emptyClientDraft(),
      ...preset.draft,
      redirectUris: ["https://dashboard.example/callback"],
      jwks: JSON.stringify({ keys: [publicKey] }),
    });
    expect(validateClientDraft(filled, withApi)).toEqual({});
    const registration = clientRegistration(filled);
    expect(registration.grantTypes).toEqual(expected.grantTypes);
    expect(registration.scopes).toEqual(expected.scopes.split(" "));
    expect(registration.clientCredentialsScopes).toEqual(
      expected.clientCredentials ? expected.scopes.split(" ") : [],
    );
    expect(registration.resources).toEqual(expected.resources);
    expect(registration.enableEndSession).toBe(preset.id === "admin-dashboard");
    expect(isRestrictedDraft(filled)).toBe(true);
  });
});

describe("editing a registered client", () => {
  const stored: OidcClientSummary = {
    clientId: "bot",
    name: "Telegram Bot",
    uri: null,
    logo: null,
    redirectUris: [],
    postLogoutRedirectUris: [],
    contacts: [],
    tosUri: null,
    policyUri: null,
    scopes: ["backend:tg:read"],
    credential: "private-key",
    restricted: true,
    authMethod: "private_key_jwt",
    grantTypes: ["client_credentials"],
    clientCredentialsScopes: ["backend:tg:read"],
    resourceIds: ["https://api.example"],
    resources: ["backend"],
    enableEndSession: false,
    jwks: JSON.stringify({ keys: [publicKey] }),
    applicationType: "web",
    disabled: false,
    skipConsent: false,
    createdAt: null,
    updatedAt: null,
    authorizedUsers: 0,
  };

  it("loads every setting into the form and saves it back unchanged", () => {
    const loaded = draftFromClient(stored);
    expect(loaded).toMatchObject({
      credential: "private-key",
      signIn: false,
      serviceAccess: true,
      apiScopes: [],
      serviceScopes: ["backend:tg:read"],
      resources: ["backend"],
      redirectUris: [""],
    });
    expect(JSON.parse(loaded.jwks)).toEqual({ keys: [publicKey] });
    const registration = clientRegistration(normalizeClientDraft(loaded));
    expect(registration).toMatchObject({
      grantTypes: stored.grantTypes,
      scopes: stored.scopes,
      clientCredentialsScopes: stored.clientCredentialsScopes,
      resources: stored.resources,
    });
  });

  it("keeps a mixed client's delegated and machine ceilings apart when saved", () => {
    const mixed: OidcClientSummary = {
      ...stored,
      redirectUris: ["https://dashboard.example/callback"],
      scopes: ["openid", "backend:admin", "backend:public:read"],
      grantTypes: ["authorization_code", "client_credentials"],
      clientCredentialsScopes: ["backend:public:read"],
    };
    const loaded = draftFromClient(mixed);
    expect(loaded).toMatchObject({
      apiScopes: ["backend:admin", "backend:public:read"],
      serviceScopes: ["backend:public:read"],
    });
    expect(clientRegistration(normalizeClientDraft({ ...loaded, name: "Renamed" }))).toMatchObject({
      scopes: mixed.scopes,
      clientCredentialsScopes: ["backend:public:read"],
    });
  });

  it("restores the resources its scopes need, so saving retries a failed link", () => {
    expect(draftFromClient({ ...stored, resourceIds: [], resources: [] }).resources).toEqual([
      "backend",
    ]);
  });
});
