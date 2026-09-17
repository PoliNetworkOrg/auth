import { describe, expect, it } from "vite-plus/test";
import { validateSecurityConfiguration } from "../../scripts/security-config.mjs";

describe("security configuration startup validation", () => {
  it.each([undefined, "", "   ", ",", "root,", "root,,other", "*", "root user"])(
    "refuses absent or malformed bootstrap allowlist %j",
    (value) => {
      expect(() => validateSecurityConfiguration({ IDP_ADMIN_USER_IDS: value })).toThrow();
    },
  );
  it("denies bootstrap for a configured tenant without an admin group", () => {
    expect(() =>
      validateSecurityConfiguration({
        PN_ENTRA_TENANT_ID: "11111111-1111-4111-8111-111111111111",
        PN_ENTRA_CLIENT_ID: "app",
        PN_ENTRA_CLIENT_SECRET: "secret",
      }),
    ).toThrow();
  });
  it("refuses malformed groups and incomplete Graph credentials even with a break-glass user", () => {
    expect(() =>
      validateSecurityConfiguration({
        IDP_ADMIN_USER_IDS: "root",
        PN_ENTRA_OIDC_ADMIN_GROUP_ID: "bad",
      }),
    ).toThrow();
    expect(() =>
      validateSecurityConfiguration({
        IDP_ADMIN_USER_IDS: "root",
        PN_ENTRA_OIDC_ADMIN_GROUP_ID: "11111111-1111-4111-8111-111111111111",
      }),
    ).toThrow();
  });
  it("accepts explicit break-glass configuration", () => {
    expect(() =>
      validateSecurityConfiguration({ IDP_ADMIN_USER_IDS: "root, another-user" }),
    ).not.toThrow();
  });
});
