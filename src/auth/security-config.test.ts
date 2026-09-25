import { describe, expect, it } from "vite-plus/test";
import { validateSecurityConfiguration as validate } from "../../scripts/security-config.mjs";

const validateSecurityConfiguration = (environment: Record<string, string | undefined>) =>
  validate({ BETTER_AUTH_SECRET: "test-only-secret-with-at-least-32-characters", ...environment });

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
  it.each([
    { BETTER_AUTH_SECRET: "" },
    { PN_ENTRA_MEMBER_GROUP_ID: "bad" },
    { PN_ENTRA_MEMBER_REFRESH_HOURS: "NaN" },
    { STUDENT_VERIFICATION_TTL_DAYS: "-1" },
    { BETTER_AUTH_URL: "javascript:alert(1)" },
    { BETTER_AUTH_URL: "http://auth.polinetwork.org" },
    { BETTER_AUTH_URL: "http://localhost.attacker.example" },
    { BETTER_AUTH_URL: "https://user:secret@auth.polinetwork.org" },
    { GOOGLE_CLIENT_ID: "partial" },
  ])("rejects malformed security settings before startup: %j", (invalid) => {
    expect(() =>
      validateSecurityConfiguration({ IDP_ADMIN_USER_IDS: "root", ...invalid }),
    ).toThrow();
  });
  it.each(["http://localhost:3000", "http://127.0.0.1:3000", "http://[::1]:3000"])(
    "accepts cleartext HTTP only for local development: %s",
    (BETTER_AUTH_URL) => {
      expect(() =>
        validateSecurityConfiguration({ IDP_ADMIN_USER_IDS: "root", BETTER_AUTH_URL }),
      ).not.toThrow();
    },
  );
});
