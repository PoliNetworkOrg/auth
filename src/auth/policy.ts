export type IdentityEvidence = {
  providerId: string;
  state: string | null;
  validUntil: Date;
  telegramId: string | null;
};

export function identityClaims(evidence: IdentityEvidence[], now = new Date()) {
  const states = new Set<string>();
  let telegramId: string | null = null;
  for (const proof of evidence) {
    if (proof.providerId === "telegram") telegramId = proof.telegramId;
    if (
      proof.validUntil > now &&
      ((proof.providerId === "pn-entra" && proof.state === "socio") ||
        (proof.providerId === "polimi-email" && proof.state === "student"))
    )
      states.add(proof.state);
  }
  return {
    states: [...states].sort(),
    telegramId,
    permissions: [
      ...(states.has("socio") ? ["membership:read"] : []),
      ...(states.has("student") ? ["student:verified"] : []),
    ],
  };
}

export function oidcIdentityClaims(claimName: string, claims: ReturnType<typeof identityClaims>) {
  return {
    [claimName]: claims,
    polinetwork_states: claims.states.join(" "),
    polinetwork_permissions: claims.permissions.join(" "),
    polinetwork_telegram_id: claims.telegramId ?? "",
  };
}

export function hasAppRole(roles: unknown, required: string) {
  return (
    Array.isArray(roles) &&
    roles.every((role) => typeof role === "string") &&
    roles.includes(required)
  );
}

export function hasPolimiStudentDomain(email: string) {
  return email.split("@").at(-1) === "mail.polimi.it";
}

export function isLoginProvider(providerId: string) {
  return providerId === "google" || providerId === "pn-entra";
}

export function isLinkOnlyProvider(providerId: unknown) {
  return providerId === "telegram";
}
