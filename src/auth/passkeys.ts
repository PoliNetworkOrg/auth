import { getAuthenticatorName } from "@better-auth/passkey";
import { z } from "zod";
import { type SignInToken, contactEmail } from "./contact-email";

export function passkeyUsername(user: { email: string; name: string }, tokens: SignInToken[]) {
  return contactEmail(user.email, tokens) ?? user.name;
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
