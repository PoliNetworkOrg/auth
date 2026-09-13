// Shared by the server and the browser: keep this file free of server-only imports.

/** Every administrator manages the same pool of clients instead of per-user ownership. */
export const OIDC_CLIENT_REFERENCE = "polinetwork";

export const oidcScopes = [
  {
    id: "openid",
    label: "Sign you in",
    description: "A stable identifier that lets the app recognize you. Always included.",
    required: true,
  },
  {
    id: "profile",
    label: "Basic profile",
    description: "Your display name and profile picture.",
    required: false,
  },
  {
    id: "polinetwork:identity",
    label: "PoliNetwork identity",
    description:
      "Your verified states (socio, student), the permissions they grant, and your linked Telegram ID.",
    required: false,
  },
  {
    id: "offline_access",
    label: "Stay signed in",
    description: "Lets the app refresh its access in the background without asking you again.",
    required: false,
  },
] as const;

export type OidcScopeId = (typeof oidcScopes)[number]["id"];
export type OidcScopeInfo = { id: string; label: string; description: string; required: boolean };

export function describeScope(id: string): OidcScopeInfo {
  return (
    oidcScopes.find((scope) => scope.id === id) ?? {
      id,
      label: id,
      description: "Additional access requested by the application.",
      required: false,
    }
  );
}

export type OidcApplicationType = "web" | "native";

export type OidcClientSummary = {
  clientId: string;
  name: string;
  uri: string | null;
  logo: string | null;
  redirectUris: string[];
  postLogoutRedirectUris: string[];
  contacts: string[];
  tosUri: string | null;
  policyUri: string | null;
  scopes: string[];
  confidential: boolean;
  applicationType: OidcApplicationType;
  disabled: boolean;
  skipConsent: boolean;
  createdAt: string | null;
  updatedAt: string | null;
  authorizedUsers: number;
};

/** Editable client settings. Strings are kept raw so forms can validate as the user types. */
export type OidcClientDraft = {
  name: string;
  uri: string;
  logo: string;
  redirectUris: string[];
  postLogoutRedirectUris: string[];
  contacts: string[];
  tosUri: string;
  policyUri: string;
  scopes: string[];
  applicationType: OidcApplicationType;
};

export type OidcClientDraftErrors = {
  name?: string;
  uri?: string;
  logo?: string;
  tosUri?: string;
  policyUri?: string;
  scopes?: string;
  redirectUris?: string;
  redirectUriItems?: (string | null)[];
  postLogoutRedirectUriItems?: (string | null)[];
  contactItems?: (string | null)[];
};

export const MAX_CLIENT_NAME_LENGTH = 80;

export function emptyClientDraft(): OidcClientDraft {
  return {
    name: "",
    uri: "",
    logo: "",
    redirectUris: [""],
    postLogoutRedirectUris: [],
    contacts: [],
    tosUri: "",
    policyUri: "",
    scopes: ["openid", "profile"],
    applicationType: "web",
  };
}

export function draftFromClient(client: OidcClientSummary): OidcClientDraft {
  return {
    name: client.name,
    uri: client.uri ?? "",
    logo: client.logo ?? "",
    redirectUris: client.redirectUris.length ? [...client.redirectUris] : [""],
    postLogoutRedirectUris: [...client.postLogoutRedirectUris],
    contacts: [...client.contacts],
    tosUri: client.tosUri ?? "",
    policyUri: client.policyUri ?? "",
    scopes: client.scopes.length ? [...client.scopes] : ["openid"],
    applicationType: client.applicationType,
  };
}

const FORBIDDEN_NATIVE_SCHEMES = new Set([
  "file:",
  "ftp:",
  "mailto:",
  "javascript:",
  "data:",
  "vbscript:",
]);

function isLoopbackHost(hostname: string) {
  const host = hostname.replace(/^\[|\]$/g, "");
  return host === "localhost" || host === "::1" || /^127(?:\.\d{1,3}){3}$/.test(host);
}

function rawHttpHost(uri: string) {
  const authority = /^http:\/\/([^/?#]*)/i.exec(uri)?.[1] ?? "";
  if (authority.startsWith("[")) return authority.slice(0, authority.indexOf("]") + 1);
  return authority.split(":")[0] ?? "";
}

/**
 * Mirrors the identity provider's redirect URI rules so the form can explain problems
 * before submitting. Web apps need https on a public host; native apps may use http on
 * the exact loopback hosts or a reverse-domain private-use scheme.
 */
export function validateRedirectUri(
  value: string,
  applicationType: OidcApplicationType,
): string | null {
  const uri = value.trim();
  if (!uri) return "Enter a redirect URI.";
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return "Must be an absolute URI, for example https://app.example/callback.";
  }
  if (uri.includes("#") || url.username || url.password)
    return "Must not include a fragment (#) or credentials.";
  const isHttp = url.protocol === "http:";
  const isHttps = url.protocol === "https:";
  const loopback = isLoopbackHost(url.hostname);
  if (applicationType === "web") {
    if (!isHttps) return "Web apps need an https URL. For local development, use a native app.";
    if (loopback)
      return "Web apps cannot redirect to localhost. For local development, use a native app.";
    return null;
  }
  if (isHttps) return loopback ? "Use http, not https, for localhost redirects." : null;
  if (isHttp) {
    const host = rawHttpHost(uri);
    return host === "localhost" || host === "127.0.0.1" || host === "[::1]"
      ? null
      : "http is only allowed on localhost, 127.0.0.1, or [::1].";
  }
  if (FORBIDDEN_NATIVE_SCHEMES.has(url.protocol)) return "This URI scheme is not allowed.";
  const scheme = url.protocol.slice(0, -1);
  if (!scheme.includes(".") || uri.startsWith(`${url.protocol}//`))
    return "Custom schemes must be reverse-domain names without //, for example org.polinetwork.app:/callback.";
  return null;
}

export function validateHttpsUrl(value: string): string | null {
  const text = value.trim();
  if (!text) return null;
  try {
    const url = new URL(text);
    if (url.protocol !== "https:") return "Must be an https URL.";
    if (url.username || url.password) return "Must not include credentials.";
    return null;
  } catch {
    return "Must be a valid https URL.";
  }
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateClientDraft(draft: OidcClientDraft): OidcClientDraftErrors {
  const errors: OidcClientDraftErrors = {};
  const name = draft.name.trim();
  if (!name) errors.name = "Give the application a name.";
  else if (name.length > MAX_CLIENT_NAME_LENGTH)
    errors.name = `Keep the name under ${MAX_CLIENT_NAME_LENGTH} characters.`;

  for (const field of ["uri", "logo", "tosUri", "policyUri"] as const) {
    const problem = validateHttpsUrl(draft[field]);
    if (problem) errors[field] = problem;
  }

  const redirectUris = draft.redirectUris.map((uri) => uri.trim());
  if (!redirectUris.some(Boolean)) errors.redirectUris = "Add at least one redirect URI.";
  const redirectItems = redirectUris.map((uri, index) => {
    if (!uri && redirectUris.length > 1) return "Enter a redirect URI or remove this row.";
    if (!uri) return null;
    if (redirectUris.indexOf(uri) !== index) return "This redirect URI is listed twice.";
    return validateRedirectUri(uri, draft.applicationType);
  });
  if (redirectItems.some(Boolean)) errors.redirectUriItems = redirectItems;

  const postLogoutItems = draft.postLogoutRedirectUris.map((uri) =>
    validateRedirectUri(uri, draft.applicationType),
  );
  if (postLogoutItems.some(Boolean)) errors.postLogoutRedirectUriItems = postLogoutItems;

  const contactItems = draft.contacts.map((contact) =>
    EMAIL_PATTERN.test(contact.trim()) ? null : "Enter a valid email address.",
  );
  if (contactItems.some(Boolean)) errors.contactItems = contactItems;

  if (!draft.scopes.includes("openid")) errors.scopes = "The openid scope is required.";
  else if (draft.scopes.some((scope) => !oidcScopes.some((known) => known.id === scope)))
    errors.scopes = "One of the selected scopes is not supported.";
  return errors;
}

export function hasDraftErrors(errors: OidcClientDraftErrors) {
  return Object.keys(errors).length > 0;
}

/** Normalizes a validated draft: trimmed values, empty rows dropped, stable scope order. */
export function normalizeClientDraft(draft: OidcClientDraft): OidcClientDraft {
  return {
    name: draft.name.trim(),
    uri: draft.uri.trim(),
    logo: draft.logo.trim(),
    redirectUris: draft.redirectUris.map((uri) => uri.trim()).filter(Boolean),
    postLogoutRedirectUris: draft.postLogoutRedirectUris.map((uri) => uri.trim()).filter(Boolean),
    contacts: draft.contacts.map((contact) => contact.trim()).filter(Boolean),
    tosUri: draft.tosUri.trim(),
    policyUri: draft.policyUri.trim(),
    scopes: oidcScopes.map((scope) => scope.id).filter((id) => draft.scopes.includes(id)),
    applicationType: draft.applicationType,
  };
}

/** Refresh tokens are only issued to clients that may request offline access. */
export function grantTypesForScopes(scopes: string[]): string[] {
  return scopes.includes("offline_access")
    ? ["authorization_code", "refresh_token"]
    : ["authorization_code"];
}

export function clientInitials(name: string) {
  return (
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part.charAt(0))
      .join("")
      .toUpperCase() || "?"
  );
}
