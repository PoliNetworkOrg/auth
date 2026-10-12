import type { OidcClientDraft, OidcClientDraftErrors } from "@/auth/oidc-clients";

export const wizardSteps = [
  { id: "basics", title: "Basics" },
  { id: "usage", title: "Usage" },
  { id: "authentication", title: "Authentication" },
  { id: "access", title: "Access" },
] as const;

export type WizardStepId = (typeof wizardSteps)[number]["id"];

const fieldsByStep: Record<WizardStepId, (keyof OidcClientDraftErrors)[]> = {
  basics: ["name", "uri", "logo", "logoDark", "tosUri", "policyUri", "contactItems"],
  usage: [],
  authentication: ["credential", "jwks"],
  access: ["redirectUris", "redirectUriItems", "postLogoutRedirectUriItems", "scopes", "apiScopes"],
};

/**
 * The errors a step is responsible for. `grants` is shared: choosing no token flow at all is
 * fixed in Usage, a credential that can't serve the chosen flows in Authentication.
 */
export function stepErrors(
  step: WizardStepId,
  errors: OidcClientDraftErrors,
  draft: OidcClientDraft,
): OidcClientDraftErrors {
  const owned: OidcClientDraftErrors = {};
  for (const field of fieldsByStep[step])
    if (errors[field] !== undefined) Object.assign(owned, { [field]: errors[field] });
  if (errors.grants) {
    const grantsStep: WizardStepId =
      draft.serviceAccess && draft.credential === "public" ? "authentication" : "usage";
    if (grantsStep === step) owned.grants = errors.grants;
  }
  return owned;
}

/** The index of the first step that still has errors, or the step count when none do. */
export function firstIncompleteStep(errors: OidcClientDraftErrors, draft: OidcClientDraft) {
  const index = wizardSteps.findIndex(
    (step) => Object.keys(stepErrors(step.id, errors, draft)).length > 0,
  );
  return index === -1 ? wizardSteps.length : index;
}
