import { describe, expect, it } from "vite-plus/test";
import { emptyClientDraft, validateClientDraft, type OidcClientDraft } from "@/auth/oidc-clients";
import { withDerivedResources } from "./use-client-draft";
import { firstIncompleteStep, stepErrors } from "./wizard-steps";

const withApi = { apiAccess: true };

function draft(overrides: Partial<OidcClientDraft>): OidcClientDraft {
  return { ...emptyClientDraft(), ...overrides };
}

describe("wizard step gating", () => {
  it("stops at Basics until the application has a name", () => {
    const nameless = draft({});
    expect(firstIncompleteStep(validateClientDraft(nameless, withApi), nameless)).toBe(0);
  });

  it("stops at Usage when the app neither signs people in nor acts as itself", () => {
    const idle = draft({ name: "App", signIn: false });
    const errors = validateClientDraft(idle, withApi);
    expect(firstIncompleteStep(errors, idle)).toBe(1);
    expect(stepErrors("usage", errors, idle).grants).toMatch(/Choose/);
    expect(stepErrors("authentication", errors, idle).grants).toBeUndefined();
  });

  it("sends a public client that acts as itself back to Authentication", () => {
    const publicService = draft({
      name: "Bot",
      signIn: false,
      serviceAccess: true,
      credential: "public",
      serviceScopes: ["backend:public:read"],
    });
    const errors = validateClientDraft(publicService, withApi);
    expect(firstIncompleteStep(errors, publicService)).toBe(2);
    expect(stepErrors("authentication", errors, publicService).grants).toMatch(/Public/);
  });

  it("asks for the JWKS in Authentication and the redirect URI in Access", () => {
    const keyed = draft({ name: "App", credential: "private-key", redirectUris: [""] });
    const errors = validateClientDraft(keyed, withApi);
    expect(firstIncompleteStep(errors, keyed)).toBe(2);
    expect(stepErrors("access", errors, keyed).redirectUris).toBeDefined();
  });

  it("opens Review once every step is complete", () => {
    const ready = draft({ name: "App", redirectUris: ["https://app.example/callback"] });
    expect(firstIncompleteStep(validateClientDraft(ready, withApi), ready)).toBe(4);
  });
});

describe("derived resource links", () => {
  it("links exactly the resources the granted API scopes belong to", () => {
    expect(
      withDerivedResources(
        draft({
          apiScopes: ["backend:admin"],
          serviceAccess: true,
          serviceScopes: ["idp:access:read"],
        }),
      ).resources,
    ).toEqual(["backend", "internal"]);
    expect(withDerivedResources(draft({ resources: ["backend"] })).resources).toEqual([]);
  });

  it("ignores the scopes of a flow the app doesn't use", () => {
    expect(
      withDerivedResources(draft({ serviceAccess: false, serviceScopes: ["idp:access:read"] }))
        .resources,
    ).toEqual([]);
  });
});
