import { getAuthenticatorName } from "@better-auth/passkey";
import { decodeJwt } from "jose";
import { z } from "zod";

function realEmail(value: unknown) {
  const parsed = z.email().safeParse(value);
  return parsed.success && !parsed.data.toLowerCase().endsWith("@identity.invalid")
    ? parsed.data
    : undefined;
}

// These stored tokens were accepted during OAuth sign-in. Their claims are used
// only as display labels, never to identify a user or grant permissions.
export function passkeyUsername(
  user: { email: string; name: string },
  accounts: { providerId: string; idToken: string | null }[],
) {
  const email = realEmail(user.email);
  if (email) return email;
  for (const provider of ["google", "pn-entra"]) {
    for (const account of accounts) {
      if (account.providerId !== provider || !account.idToken) continue;
      let claims;
      try {
        claims = decodeJwt(account.idToken);
      } catch {
        continue;
      }
      for (const candidate of [claims.email, claims.preferred_username, claims.upn]) {
        const address = realEmail(candidate);
        if (address) return address;
      }
    }
  }
  return user.name;
}

export function passkeyLabel(passkey: { name?: string | null; aaguid?: string | null }) {
  const name = passkey.name?.trim();
  if (name && name !== "PoliNetwork passkey") return name;
  return getAuthenticatorName(passkey.aaguid) ?? "Passkey";
}

export const registrationOptionsSchema = z.looseObject({
  user: z.looseObject({ id: z.string(), name: z.string(), displayName: z.string() }),
});

export const passkeyListSchema = z.array(
  z.looseObject({ name: z.string().nullish(), aaguid: z.string().nullish() }),
);
