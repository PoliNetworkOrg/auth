export type IdentityEvidence = {
  providerId: string;
  states: string[];
  validUntil: Date;
  telegramId: string | null;
};

/** Which provider is trusted to prove which state. Evidence from anywhere else is ignored. */
const STATE_PROVIDERS: Record<string, string> = {
  socio: "pn-entra",
  direttivo: "pn-entra",
  student: "polimi-email",
};

/** The states a person's linked accounts currently prove, plus their Telegram identity. */
export function identityStates(evidence: IdentityEvidence[], now = new Date()) {
  const states = new Set<string>();
  let telegramId: string | null = null;
  for (const proof of evidence) {
    if (proof.providerId === "telegram") telegramId = proof.telegramId;
    if (proof.validUntil <= now) continue;
    for (const state of proof.states)
      if (STATE_PROVIDERS[state] === proof.providerId) states.add(state);
  }
  return { states: [...states].sort(), telegramId };
}

/** What `/api/identity`, the ID token, and UserInfo report about a person. */
export type IdentityClaims = {
  states: string[];
  roles: string[];
  permissions: string[];
  telegramId: string | null;
};

export function oidcIdentityClaims(claimName: string, claims: IdentityClaims) {
  return {
    [claimName]: claims,
    polinetwork_states: claims.states.join(" "),
    polinetwork_roles: claims.roles.join(" "),
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
