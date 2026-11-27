import { describe, expect, it } from "vite-plus/test";
import { accountIssuer } from "./account-issuer";

const TENANT = "11111111-1111-4111-8111-111111111111";

describe("account issuer", () => {
  // The values Better Auth 1.7.2 stored; changing one would detach existing accounts from
  // their identity evidence.
  it.each([
    ["google", "https://accounts.google.com"],
    ["telegram", "https://oauth.telegram.org"],
    ["polimi-email", "https://mail.polimi.it"],
    ["pn-entra", `https://login.microsoftonline.com/${TENANT}/v2.0`],
  ])("gives %s accounts the issuer %s", (providerId, issuer) => {
    expect(accountIssuer(providerId, TENANT)).toBe(issuer);
  });

  it("refuses an Entra account without a configured tenant", () => {
    expect(() => accountIssuer("pn-entra", undefined)).toThrow(/PN_ENTRA_TENANT_ID/);
  });

  it.each(["credential", "microsoft", "", "pn-entra "])(
    "refuses a provider with no known issuer: %j",
    (providerId) => {
      expect(() => accountIssuer(providerId, TENANT)).toThrow(/No account issuer/);
    },
  );
});
