import { useState } from "react";
import {
  activeApiScopes,
  resourcesForScopes,
  type OidcClientCredential,
  type OidcClientDraft,
} from "@/auth/oidc-clients";

type ScopeList = "scopes" | "apiScopes" | "serviceScopes";

/**
 * Links exactly the resources the granted API scopes belong to. A scope is only usable on a
 * token addressed to its resource, so nobody has to pick the resource by hand.
 */
export function withDerivedResources(draft: OidcClientDraft): OidcClientDraft {
  return { ...draft, resources: resourcesForScopes(activeApiScopes(draft)) };
}

/** The application form's draft and the edits both the wizard and the settings page make. */
export function useClientDraft(initial: OidcClientDraft) {
  const [draft, setDraftState] = useState(() => withDerivedResources(initial));
  const change = (edit: (current: OidcClientDraft) => OidcClientDraft) =>
    setDraftState((current) => withDerivedResources(edit(current)));

  return {
    draft,
    /** Replaces the whole draft, for reloading saved values. */
    reset: (next: OidcClientDraft) => setDraftState(withDerivedResources(next)),
    update: <K extends keyof OidcClientDraft>(key: K, value: OidcClientDraft[K]) =>
      change((current) => ({ ...current, [key]: value })),
    setCredential: (credential: OidcClientCredential) =>
      // Public clients cannot authenticate, so they cannot obtain tokens as themselves.
      change((current) => ({
        ...current,
        credential,
        ...(credential === "public" ? { serviceAccess: false } : {}),
      })),
    toggleScope: (list: ScopeList, scope: string, checked: boolean) =>
      change((current) => ({
        ...current,
        [list]: checked
          ? [...new Set([...current[list], scope])]
          : current[list].filter((id) => id !== scope),
      })),
  };
}

export type ClientDraftApi = ReturnType<typeof useClientDraft>;
