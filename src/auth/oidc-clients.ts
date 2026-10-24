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
    id: "email",
    label: "Email address",
    description: "Your email address and whether it has been verified.",
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

/** Scopes people may be asked for that applications in the pool cannot pick. */
const otherScopes: OidcScopeInfo[] = [
  {
    id: "idp:mcp",
    label: "Use PoliNetwork Auth as you",
    description:
      "An AI agent reads and changes this identity provider with your permissions, such as applications, roles and people you can manage.",
    required: false,
  },
];

export function describeScope(id: string): OidcScopeInfo {
  return (
    oidcScopes.find((scope) => scope.id === id) ??
    otherScopes.find((scope) => scope.id === id) ?? {
      id,
      label: id,
      description: "Additional access requested by the application.",
      required: false,
    }
  );
}

/**
 * Scopes for PoliNetwork's own APIs. Granting any of them, or a link to their resource, is
 * reserved to Master Admin.
 */
export const apiScopes = [
  {
    id: "backend:admin",
    label: "Backend administration",
    description: "Administer the backend on behalf of the signed-in person.",
    resource: "backend",
  },
  {
    id: "backend:public:read",
    label: "Public backend data",
    description: "Read the backend's public data.",
    resource: "backend",
  },
  {
    id: "backend:tg:read",
    label: "Telegram: read",
    description: "Read Telegram groups, members, and settings.",
    resource: "backend",
  },
  {
    id: "backend:tg:ingest",
    label: "Telegram: ingest",
    description: "Submit Telegram updates to the backend.",
    resource: "backend",
  },
  {
    id: "backend:tg:groups:sync",
    label: "Telegram: sync groups",
    description: "Synchronize Telegram group metadata.",
    resource: "backend",
  },
  {
    id: "backend:tg:audit",
    label: "Telegram: audit",
    description: "Write Telegram moderation audit records.",
    resource: "backend",
  },
  {
    id: "backend:tg:act-as",
    label: "Telegram: act as a member",
    description: "Act on behalf of a linked Telegram member.",
    resource: "backend",
  },
  {
    id: "backend:tg:events",
    label: "Telegram: events",
    description: "Receive the backend's Telegram event stream.",
    resource: "backend",
  },
  {
    id: "idp:access:read",
    label: "Access snapshot",
    description: "Pull every member's roles and permissions from this identity provider.",
    resource: "internal",
  },
] as const;

export type OidcResourceKey = (typeof apiScopes)[number]["resource"];

export const oidcResources: { id: OidcResourceKey; label: string; description: string }[] = [
  {
    id: "backend",
    label: "PoliNetwork backend",
    description: "Access tokens addressed to the backend API.",
  },
  {
    id: "internal",
    label: "Identity provider internals",
    description: "Access tokens for this identity provider's internal endpoints.",
  },
];

/** Prefix match on purpose: a backend scope added later is privileged before it is listed. */
export function isApiScope(scope: string) {
  return scope.startsWith("backend:") || scope === "idp:access:read";
}

/** The resources the selected API scopes need, in a stable order. */
export function resourcesForScopes(scopes: string[]): OidcResourceKey[] {
  return oidcResources
    .map((resource) => resource.id)
    .filter((id) => apiScopes.some((scope) => scope.resource === id && scopes.includes(scope.id)));
}

type RestrictionInput = {
  grantTypes: string[] | null;
  scopes: string[] | null;
  clientCredentialsScopes: string[] | null;
  resourceIds?: string[];
};

/**
 * Whether only Master Admin may change a client: one that obtains tokens as itself, holds an
 * API scope, or is linked to an API resource.
 */
export function isRestrictedClient(client: RestrictionInput) {
  return (
    Boolean(client.grantTypes?.includes("client_credentials")) ||
    Boolean(client.clientCredentialsScopes?.length) ||
    Boolean(client.scopes?.some(isApiScope)) ||
    Boolean(client.resourceIds?.length)
  );
}

export type OidcApplicationType = "web" | "native";

/** How the client authenticates to the token endpoint. */
export type OidcClientCredential = "secret" | "private-key" | "public";

export function credentialOf(authMethod: string | null): OidcClientCredential {
  if (authMethod === "none") return "public";
  if (authMethod === "private_key_jwt") return "private-key";
  return "secret";
}

export const credentialLabels: Record<OidcClientCredential, string> = {
  secret: "Client secret",
  "private-key": "Private key",
  public: "Public",
};

export type OidcClientSummary = {
  clientId: string;
  name: string;
  uri: string | null;
  logo: string | null;
  /** Drawn instead of `logo` on dark backgrounds. */
  logoDark: string | null;
  redirectUris: string[];
  postLogoutRedirectUris: string[];
  contacts: string[];
  tosUri: string | null;
  policyUri: string | null;
  scopes: string[];
  credential: OidcClientCredential;
  /** Only Master Admin may change it; see `isRestrictedClient`. */
  restricted: boolean;
  authMethod: string | null;
  grantTypes: string[];
  clientCredentialsScopes: string[];
  /** Linked resource identifiers, as stored. */
  resourceIds: string[];
  /** The linked resources this deployment knows, by key. */
  resources: OidcResourceKey[];
  enableEndSession: boolean;
  jwks: string | null;
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
  logoDark: string;
  redirectUris: string[];
  postLogoutRedirectUris: string[];
  contacts: string[];
  tosUri: string;
  policyUri: string;
  applicationType: OidcApplicationType;
  credential: OidcClientCredential;
  /** The public JWKS as typed; only used with a private key. */
  jwks: string;
  /** Signs people in with the authorization code flow. */
  signIn: boolean;
  /** Sign-in scopes from `oidcScopes`; only used when signing people in. */
  scopes: string[];
  /** Obtains tokens as itself with the client credentials grant. */
  serviceAccess: boolean;
  /** Scopes from `apiScopes` the app may request for the people it signs in. */
  apiScopes: string[];
  /** Scopes from `apiScopes` the app may request as itself; its client credentials ceiling. */
  serviceScopes: string[];
  resources: OidcResourceKey[];
  enableEndSession: boolean;
};

export type OidcClientDraftErrors = {
  name?: string;
  uri?: string;
  logo?: string;
  logoDark?: string;
  tosUri?: string;
  policyUri?: string;
  credential?: string;
  jwks?: string;
  grants?: string;
  scopes?: string;
  apiScopes?: string;
  redirectUris?: string;
  redirectUriItems?: (string | null)[];
  postLogoutRedirectUriItems?: (string | null)[];
  contactItems?: (string | null)[];
};

export const MAX_CLIENT_NAME_LENGTH = 80;
export const MAX_JWKS_KEYS = 5;

export function emptyClientDraft(): OidcClientDraft {
  return {
    name: "",
    uri: "",
    logo: "",
    logoDark: "",
    redirectUris: [""],
    postLogoutRedirectUris: [],
    contacts: [],
    tosUri: "",
    policyUri: "",
    applicationType: "web",
    credential: "secret",
    jwks: "",
    signIn: true,
    scopes: ["openid", "profile"],
    serviceAccess: false,
    apiScopes: [],
    serviceScopes: [],
    resources: [],
    enableEndSession: false,
  };
}

export function prettyJwks(jwks: string | null) {
  if (!jwks) return "";
  try {
    return JSON.stringify(JSON.parse(jwks), null, 2);
  } catch {
    return jwks;
  }
}

export function draftFromClient(client: OidcClientSummary): OidcClientDraft {
  const signIn = client.grantTypes.includes("authorization_code");
  const serviceAccess = client.grantTypes.includes("client_credentials");
  const userScopes = client.scopes.filter((scope) => !isApiScope(scope));
  // The two ceilings are kept apart, so saving never lets the app use a delegated scope as
  // itself or the other way round.
  const delegated = signIn ? client.scopes.filter(isApiScope) : [];
  const machine = serviceAccess ? [...client.clientCredentialsScopes] : [];
  return {
    name: client.name,
    uri: client.uri ?? "",
    logo: client.logo ?? "",
    logoDark: client.logoDark ?? "",
    redirectUris: client.redirectUris.length ? [...client.redirectUris] : [""],
    postLogoutRedirectUris: [...client.postLogoutRedirectUris],
    contacts: [...client.contacts],
    tosUri: client.tosUri ?? "",
    policyUri: client.policyUri ?? "",
    applicationType: client.applicationType,
    credential: client.credential,
    jwks: prettyJwks(client.jwks),
    signIn,
    scopes: signIn && userScopes.length ? userScopes : ["openid", "profile"],
    serviceAccess,
    apiScopes: delegated,
    serviceScopes: machine,
    // Also restores links that failed after creation, so saving retries them.
    resources: [
      ...new Set([...client.resources, ...resourcesForScopes([...delegated, ...machine])]),
    ],
    enableEndSession: client.enableEndSession,
  };
}

export type PublicJwks = { keys: Record<string, unknown>[] };

const PRIVATE_JWK_FIELDS = ["d", "p", "q", "dp", "dq", "qi", "oth", "k"];

/**
 * Reads a pasted public JWKS, with a message that says what to fix. The server checks the
 * key types and their reuse across clients again.
 */
export function parsePublicJwks(input: string): PublicJwks {
  let parsed: unknown;
  try {
    parsed = JSON.parse(input);
  } catch {
    throw new Error("Paste a valid public JWKS JSON object.");
  }
  if (!parsed || typeof parsed !== "object" || !("keys" in parsed))
    throw new Error("The JWKS needs a keys array.");
  const keys = (parsed as { keys: unknown }).keys;
  if (!Array.isArray(keys) || keys.length === 0 || keys.length > MAX_JWKS_KEYS)
    throw new Error(`The JWKS needs between one and ${MAX_JWKS_KEYS} public keys.`);
  for (const key of keys) {
    if (!key || typeof key !== "object" || Array.isArray(key))
      throw new Error("Each key must be an object.");
    if (PRIVATE_JWK_FIELDS.some((field) => field in key))
      throw new Error("Paste public keys only. Keep the private key with the service.");
  }
  return { keys: keys as Record<string, unknown>[] };
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

/** The API scopes the draft actually grants, given the token flows it uses. */
export function activeApiScopes(draft: OidcClientDraft) {
  return [
    ...new Set([
      ...(draft.signIn ? draft.apiScopes : []),
      ...(draft.serviceAccess ? draft.serviceScopes : []),
    ]),
  ];
}

export type DraftValidationOptions = {
  /** Whether this deployment has API resources, and so API scopes and service access. */
  apiAccess: boolean;
};

export function validateClientDraft(
  draft: OidcClientDraft,
  { apiAccess }: DraftValidationOptions,
): OidcClientDraftErrors {
  const errors: OidcClientDraftErrors = {};
  const name = draft.name.trim();
  if (!name) errors.name = "Give the application a name.";
  else if (name.length > MAX_CLIENT_NAME_LENGTH)
    errors.name = `Keep the name under ${MAX_CLIENT_NAME_LENGTH} characters.`;

  for (const field of ["uri", "logo", "logoDark", "tosUri", "policyUri"] as const) {
    const problem = validateHttpsUrl(draft[field]);
    if (problem) errors[field] = problem;
  }

  if (draft.credential === "private-key") {
    if (!draft.jwks.trim()) errors.jwks = "Paste the public JWKS the app signs with.";
    else
      try {
        parsePublicJwks(draft.jwks);
      } catch (cause) {
        errors.jwks = (cause as Error).message;
      }
  }

  if (!draft.signIn && !draft.serviceAccess)
    errors.grants = "Choose how the application obtains tokens.";
  else if (draft.serviceAccess && !apiAccess)
    errors.grants = "API access is not configured on this server.";
  else if (draft.serviceAccess && draft.credential === "public")
    errors.grants = "Public clients cannot obtain tokens as themselves. Use a secret or a key.";

  if (draft.signIn) {
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

    if (!draft.scopes.includes("openid")) errors.scopes = "The openid scope is required.";
    else if (draft.scopes.some((scope) => !oidcScopes.some((known) => known.id === scope)))
      errors.scopes = "One of the selected scopes is not supported.";
  }

  const contactItems = draft.contacts.map((contact) =>
    EMAIL_PATTERN.test(contact.trim()) ? null : "Enter a valid email address.",
  );
  if (contactItems.some(Boolean)) errors.contactItems = contactItems;

  const selected = activeApiScopes(draft);
  if (selected.some((scope) => !apiScopes.some((known) => known.id === scope)))
    errors.apiScopes = "One of the selected API scopes is not supported.";
  else if ((selected.length || draft.resources.length) && !apiAccess)
    errors.apiScopes = "API access is not configured on this server.";
  else if (draft.serviceAccess && !draft.serviceScopes.length)
    errors.apiScopes = "Choose the API scopes the application may use as itself.";
  else if (resourcesForScopes(selected).some((resource) => !draft.resources.includes(resource)))
    errors.apiScopes = "Link the resources the selected API scopes belong to.";
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
    logoDark: draft.logoDark.trim(),
    redirectUris: draft.redirectUris.map((uri) => uri.trim()).filter(Boolean),
    postLogoutRedirectUris: draft.postLogoutRedirectUris.map((uri) => uri.trim()).filter(Boolean),
    contacts: draft.contacts.map((contact) => contact.trim()).filter(Boolean),
    tosUri: draft.tosUri.trim(),
    policyUri: draft.policyUri.trim(),
    applicationType: draft.applicationType,
    credential: draft.credential,
    jwks: draft.credential === "private-key" ? draft.jwks.trim() : "",
    signIn: draft.signIn,
    scopes: oidcScopes.map((scope) => scope.id).filter((id) => draft.scopes.includes(id)),
    serviceAccess: draft.serviceAccess,
    apiScopes: draft.signIn
      ? apiScopes.map((scope) => scope.id).filter((id) => draft.apiScopes.includes(id))
      : [],
    serviceScopes: draft.serviceAccess
      ? apiScopes.map((scope) => scope.id).filter((id) => draft.serviceScopes.includes(id))
      : [],
    resources: oidcResources
      .map((resource) => resource.id)
      .filter((id) => draft.resources.includes(id)),
    enableEndSession: draft.enableEndSession,
  };
}

/** What a normalized draft registers: the grants, scopes, and URIs the client is stored with. */
export function clientRegistration(draft: OidcClientDraft) {
  const grantTypes: string[] = [];
  if (draft.signIn) grantTypes.push("authorization_code");
  // Refresh tokens are only issued to clients that may request offline access.
  if (draft.signIn && draft.scopes.includes("offline_access")) grantTypes.push("refresh_token");
  if (draft.serviceAccess) grantTypes.push("client_credentials");
  return {
    grantTypes,
    // Client credentials read their own ceiling; `scopes` only needs it for a client that
    // never signs people in, which keeps that client's scopes meaningful.
    scopes: draft.signIn ? [...draft.scopes, ...draft.apiScopes] : draft.serviceScopes,
    clientCredentialsScopes: draft.serviceAccess ? draft.serviceScopes : [],
    redirectUris: draft.signIn ? draft.redirectUris : [],
    postLogoutRedirectUris: draft.signIn ? draft.postLogoutRedirectUris : [],
    enableEndSession: draft.signIn && draft.enableEndSession,
    resources: draft.resources,
  };
}

/** Whether saving this normalized draft needs Master Admin. */
export function isRestrictedDraft(draft: OidcClientDraft) {
  const registration = clientRegistration(draft);
  return isRestrictedClient({ ...registration, resourceIds: registration.resources });
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
