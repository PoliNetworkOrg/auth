import { describe, expect, it } from "vite-plus/test";
import { contactEmail, directoryEmail } from "./contact-email";

const placeholder = "pn-entra.subject@identity.invalid";
const token = (claims: Record<string, unknown>) =>
  `${Buffer.from('{"alg":"RS256"}').toString("base64url")}.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.signature`;

describe("contact email", () => {
  it("prefers the address saved at sign-in over the one in the saved token", () => {
    const idToken = token({ preferred_username: "old@polinetwork.org" });
    expect(
      contactEmail(placeholder, [
        { providerId: "pn-entra", idToken, email: "alex@polinetwork.org" },
      ]),
    ).toBe("alex@polinetwork.org");
    expect(contactEmail(placeholder, [{ providerId: "pn-entra", idToken, email: null }])).toBe(
      "old@polinetwork.org",
    );
  });

  it("ignores saved addresses from providers that do not carry one", () => {
    expect(
      contactEmail(placeholder, [
        { providerId: "telegram", idToken: null, email: "someone@example.com" },
      ]),
    ).toBeUndefined();
  });

  it("shows the PoliNetwork address in the directory, then the stored one", () => {
    const pn = { providerId: "pn-entra", idToken: null, email: "alex@polinetwork.org" };
    expect(directoryEmail("alex@gmail.com", [pn])).toBe("alex@polinetwork.org");
    expect(contactEmail("alex@gmail.com", [pn])).toBe("alex@gmail.com");
    expect(directoryEmail("alex@gmail.com", [])).toBe("alex@gmail.com");
  });
});
