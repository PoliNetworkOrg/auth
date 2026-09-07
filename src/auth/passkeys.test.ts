import { describe, expect, it } from "vite-plus/test";
import { passkeyLabel, passkeyUsername } from "./passkeys";

const user = { email: "pn-entra.subject@identity.invalid", name: "Alex" };
const token = (claims: Record<string, unknown>) =>
  `${Buffer.from('{"alg":"RS256"}').toString("base64url")}.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.signature`;

describe("passkey display metadata", () => {
  it("uses the user's real email before linked provider labels", () => {
    expect(passkeyUsername({ ...user, email: "alex@gmail.com" }, [])).toBe("alex@gmail.com");
  });

  it("prefers Google then Microsoft email claims for synthetic identities", () => {
    const microsoft = {
      providerId: "pn-entra",
      idToken: token({ preferred_username: "alex@polinetwork.org" }),
    };
    const google = { providerId: "google", idToken: token({ email: "alex@gmail.com" }) };
    expect(passkeyUsername(user, [microsoft, google])).toBe("alex@gmail.com");
    expect(passkeyUsername(user, [microsoft])).toBe("alex@polinetwork.org");
  });

  it("ignores invalid tokens, non-email claims, and verifier accounts", () => {
    expect(
      passkeyUsername(user, [
        { providerId: "google", idToken: "broken" },
        {
          providerId: "pn-entra",
          idToken: token({
            email: "fake@identity.invalid",
            preferred_username: "not-an-email",
            upn: "alex@polinetwork.org",
          }),
        },
      ]),
    ).toBe("alex@polinetwork.org");
    expect(
      passkeyUsername(user, [
        { providerId: "telegram", idToken: token({ email: "someone@example.com" }) },
      ]),
    ).toBe("Alex");
  });

  it("relabels existing default names using the saved authenticator ID", () => {
    expect(
      passkeyLabel({ name: "PoliNetwork passkey", aaguid: "bada5566-a7aa-401f-bd96-45619a55120d" }),
    ).toBe("1Password");
    expect(passkeyLabel({ aaguid: "ea9b8d66-4d01-1d21-3ce4-b6b48cb575d4" })).toBe(
      "Google Password Manager",
    );
  });

  it("preserves custom names and does not guess an unknown device", () => {
    expect(
      passkeyLabel({ name: "Office key", aaguid: "bada5566-a7aa-401f-bd96-45619a55120d" }),
    ).toBe("Office key");
    expect(
      passkeyLabel({ name: "PoliNetwork passkey", aaguid: "00000000-0000-0000-0000-000000000000" }),
    ).toBe("Passkey");
  });
});
