import { oauthProvider } from "@better-auth/oauth-provider";
import { describe, expect, it } from "vite-plus/test";
import { rawClientMutationPaths, refusedClientMutationPaths } from "./client-endpoints";

/**
 * Client writes the provider offers that stay open, each reviewed: none can change an
 * existing client outside the RBAC write lock.
 */
const reviewedClientWrites = [
  // Server only. The form registers through it after its own Master Admin check, and a
  // client that does not exist yet cannot be promoted in the meantime.
  "/admin/oauth2/create-client",
  // Server only, and `resourcePrivileges` in `index.ts` refuses link and unlink to everyone.
  "/admin/oauth2/resources/:identifier/clients/:client_id",
  // A read that uses POST.
  "/oauth2/public-client-prelogin",
];

const endpoints = Object.values(
  oauthProvider({ loginPage: "/", consentPage: "/consent" }).endpoints,
).map((endpoint) => ({
  path: endpoint.path,
  methods: [endpoint.options.method].flat(),
  serverOnly: "SERVER_ONLY" in (endpoint.options.metadata ?? {}),
}));

describe("provider client endpoints", () => {
  it("closes every other client write the provider offers", () => {
    const writes = endpoints.filter(
      (endpoint) =>
        endpoint.path.includes("client") && endpoint.methods.some((method) => method !== "GET"),
    );
    expect(writes.length).toBeGreaterThan(0);
    for (const { path } of writes)
      expect([...refusedClientMutationPaths, ...reviewedClientWrites]).toContain(path);
  });

  it("closes over HTTP every raw mutation a browser could reach", () => {
    for (const path of rawClientMutationPaths) {
      const endpoint = endpoints.find((candidate) => candidate.path === path);
      expect(endpoint, path).toMatchObject({ serverOnly: false });
    }
    const browserWrites = endpoints.filter(
      (endpoint) =>
        !endpoint.serverOnly &&
        endpoint.path.includes("client") &&
        endpoint.methods.some((method) => method !== "GET") &&
        !reviewedClientWrites.includes(endpoint.path),
    );
    expect(browserWrites.map((endpoint) => endpoint.path).sort()).toEqual(
      [...rawClientMutationPaths].sort(),
    );
  });
});
