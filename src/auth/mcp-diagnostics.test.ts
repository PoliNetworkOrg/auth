import { describe, expect, it } from "vite-plus/test";
import {
  checkAuthorizationRequest,
  diagnoseClient,
  explainPermission,
  matchRedirectUri,
} from "./mcp-diagnostics";
import type { OidcClientSummary } from "./oidc-clients";
import type { PermissionSummary, RbacCatalog, RoleSummary } from "./rbac";

const authorizeEndpoint = "https://auth.polinetwork.org/api/auth/oauth2/authorize";
const resources = { backend: "https://backend.internal.polinetwork.org" };

function client(overrides: Partial<OidcClientSummary> = {}): OidcClientSummary {
  return {
    clientId: "wiki",
    name: "Wiki",
    uri: null,
    logo: null,
    logoDark: null,
    redirectUris: ["https://wiki.polinetwork.org/callback"],
    postLogoutRedirectUris: [],
    contacts: [],
    tosUri: null,
    policyUri: null,
    scopes: ["openid", "profile", "offline_access"],
    credential: "secret",
    restricted: false,
    authMethod: "client_secret_basic",
    grantTypes: ["authorization_code", "refresh_token"],
    clientCredentialsScopes: [],
    resourceIds: [],
    resources: [],
    enableEndSession: false,
    jwks: null,
    applicationType: "web",
    disabled: false,
    skipConsent: false,
    createdAt: null,
    updatedAt: null,
    authorizedUsers: 3,
    ...overrides,
  };
}

function authorize(params: Record<string, string>) {
  return `${authorizeEndpoint}?${new URLSearchParams({
    response_type: "code",
    client_id: "wiki",
    redirect_uri: "https://wiki.polinetwork.org/callback",
    scope: "openid profile",
    state: "s",
    code_challenge: "c",
    code_challenge_method: "S256",
    ...params,
  })}`;
}

function messages(findings: { level: string; message: string }[], level = "error") {
  return findings.filter((finding) => finding.level === level).map((finding) => finding.message);
}

describe("redirect URI matching", () => {
  it("matches exactly, except for the port of a loopback IP address", () => {
    const registered = ["https://app.example/cb", "http://127.0.0.1:3000/cb", "http://[::1]/cb"];
    expect(matchRedirectUri(registered, "https://app.example/cb")).toBe(registered[0]);
    expect(matchRedirectUri(registered, "https://app.example/cb/")).toBeUndefined();
    expect(matchRedirectUri(registered, "http://127.0.0.1:51234/cb")).toBe(registered[1]);
    expect(matchRedirectUri(registered, "http://[::1]:8080/cb")).toBe(registered[2]);
    expect(matchRedirectUri(["http://localhost:3000/cb"], "http://localhost:4000/cb")).toBe(
      undefined,
    );
  });
});

describe("authorization request check", () => {
  const internal = "https://auth.polinetwork.org/api/internal";
  const context = {
    authorizeEndpoint,
    resourcePolicies: {
      [resources.backend]: { allowedScopes: null, disabled: false },
      [internal]: { allowedScopes: ["idp:access:read"], disabled: false },
    },
  };

  it("accepts a request the provider would accept", () => {
    const findings = checkAuthorizationRequest(client(), authorize({}), context);
    expect(messages(findings)).toEqual([]);
    expect(messages(findings, "info").at(-1)).toMatch(/would accept/);
  });

  it("names the near miss behind an unregistered redirect URI", () => {
    const trailing = checkAuthorizationRequest(
      client(),
      authorize({ redirect_uri: "https://wiki.polinetwork.org/callback/" }),
      context,
    );
    expect(messages(trailing)[0]).toMatch(/trailing slash/);
    const port = checkAuthorizationRequest(
      client({ redirectUris: ["http://localhost:3000/cb"], applicationType: "native" }),
      authorize({ redirect_uri: "http://localhost:4000/cb" }),
      context,
    );
    expect(messages(port)[0]).toMatch(/port differs.*not localhost/);
    const host = checkAuthorizationRequest(
      client({ redirectUris: ["http://localhost:3000/cb"], applicationType: "native" }),
      authorize({ redirect_uri: "http://127.0.0.1:3000/cb" }),
      context,
    );
    expect(messages(host)[0]).toMatch(/loopback host differs/);
  });

  it("reports scopes, PKCE, response type, client and resource problems", () => {
    const findings = messages(
      checkAuthorizationRequest(
        client({ disabled: true }),
        authorize({
          client_id: "other",
          response_type: "token",
          scope: "openid email",
          code_challenge_method: "plain",
          resource: resources.backend,
        }),
        context,
      ),
    );
    expect(findings.join("\n")).toMatch(/client_id is other/);
    expect(findings.join("\n")).toMatch(/unsupported_response_type/);
    expect(findings.join("\n")).toMatch(/client_disabled/);
    expect(findings.join("\n")).toMatch(/invalid_scope.*email/);
    expect(findings.join("\n")).toMatch(/only S256/);
    expect(findings.join("\n")).toMatch(/not linked to resource/);
  });

  it("applies the scope policy of a requested resource", () => {
    const linked = client({ resourceIds: [internal], scopes: ["openid", "profile"] });
    const refused = checkAuthorizationRequest(linked, authorize({ resource: internal }), context);
    expect(messages(refused)).toEqual([expect.stringMatching(/invalid_scope.*idp:access:read/)]);
    expect(messages(refused, "info").join("\n")).not.toMatch(/would accept/);
  });

  it("reads a bare query string, and a request without PKCE", () => {
    const query = new URL(authorize({})).search;
    const findings = checkAuthorizationRequest(
      client(),
      query.replace(/&code_challenge=[^&]*/, ""),
      context,
    );
    expect(messages(findings)).toEqual([expect.stringMatching(/PKCE is missing/)]);
  });
});

describe("client diagnosis", () => {
  it("finds settings that make tokens impossible", () => {
    const findings = diagnoseClient(
      client({
        disabled: true,
        redirectUris: [],
        scopes: ["openid", "backend:admin"],
        grantTypes: ["authorization_code", "refresh_token"],
      }),
      { resources },
    );
    const errors = messages(findings).join("\n");
    expect(errors).toMatch(/disabled/);
    expect(errors).toMatch(/no redirect URI/);
    expect(errors).toMatch(/not linked to https:\/\/backend/);
    expect(messages(findings, "warning").join("\n")).toMatch(/never given a refresh token/);
    expect(findings[0]!.level).toBe("error");
  });

  it("reports nothing worse than notes for a healthy client", () => {
    expect(messages(diagnoseClient(client(), { resources }))).toEqual([]);
    expect(messages(diagnoseClient(client(), { resources }), "warning")).toEqual([]);
  });
});

function permission(key: string, implies: string[] = []): PermissionSummary {
  const base = { id: `p-${key}`, key, name: key, description: null, managed: false };
  return { ...base, implies, roleCount: 0, createdAt: null, updatedAt: null };
}

function role(key: string, permissions: string[] = [], parents: string[] = []): RoleSummary {
  const base = { id: `r-${key}`, key, name: key, description: null, managed: false };
  return {
    ...base,
    sourceState: null,
    permissions,
    parents,
    memberCount: 0,
    createdAt: null,
    updatedAt: null,
  };
}

describe("permission explanation", () => {
  const catalog: RbacCatalog = {
    roles: [
      role("master-admin"),
      role("moderator", ["tg:moderate"]),
      role("lead", [], ["moderator"]),
      role("reader", ["tg:audit:read"]),
    ],
    permissions: [
      permission("tg:moderate", ["tg:trusted"]),
      permission("tg:trusted"),
      permission("tg:audit:read"),
    ],
  };

  it("follows role inheritance and then permission implications", () => {
    expect(explainPermission(catalog, ["lead", "reader"], "tg:trusted")).toEqual([
      {
        heldRole: "lead",
        rolePath: ["lead", "moderator"],
        permissionPath: ["tg:moderate", "tg:trusted"],
      },
    ]);
  });

  it("explains Master Admin by its wildcard and nothing else", () => {
    expect(explainPermission(catalog, ["master-admin"], "tg:audit:read")).toEqual([
      { heldRole: "master-admin", rolePath: ["master-admin"], permissionPath: ["tg:audit:read"] },
    ]);
    expect(explainPermission(catalog, ["reader"], "tg:moderate")).toEqual([]);
    expect(explainPermission(catalog, ["master-admin"], "no:such")).toEqual([]);
  });
});
