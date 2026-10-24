import { MASTER_ADMIN_ROLE_KEY, type RbacCatalog } from "./rbac";
import {
  isApiScope,
  parsePublicJwks,
  resourcesForScopes,
  validateRedirectUri,
  type OidcClientSummary,
  type OidcResourceKey,
} from "./oidc-clients";

/**
 * What the MCP server's debugging tools report. Each rule mirrors a check the OAuth provider
 * makes, so a finding names the error the client actually gets back.
 */
export type Finding = { level: "error" | "warning" | "info"; message: string };

export type DiagnosisContext = {
  /** The resource identifiers this deployment configures, by key. */
  resources: Partial<Record<OidcResourceKey, string>>;
};

function findings() {
  const list: Finding[] = [];
  return {
    list,
    error: (message: string) => list.push({ level: "error", message }),
    warning: (message: string) => list.push({ level: "warning", message }),
    info: (message: string) => list.push({ level: "info", message }),
  };
}

function isLoopbackIp(hostname: string) {
  const host = hostname.replace(/^\[|\]$/g, "");
  return host === "::1" || /^127(?:\.\d{1,3}){3}$/.test(host);
}

/**
 * The registered redirect URI a request's `redirect_uri` matches, as the provider decides it:
 * the exact string, or the same loopback IP address, scheme, path and query on any port
 * (RFC 8252 §7.3). `localhost` gets no such leniency.
 */
export function matchRedirectUri(registered: readonly string[], requested: string) {
  let request: URL | null = null;
  try {
    request = new URL(requested);
  } catch {
    request = null;
  }
  return registered.find((uri) => {
    if (uri === requested) return true;
    if (!request) return false;
    try {
      const entry = new URL(uri);
      return (
        isLoopbackIp(entry.hostname) &&
        entry.hostname === request.hostname &&
        entry.pathname === request.pathname &&
        entry.protocol === request.protocol &&
        entry.search === request.search
      );
    } catch {
      return false;
    }
  });
}

/** Why a near miss did not match, for the commonest mistakes. */
function nearMiss(registered: readonly string[], requested: string): string | null {
  let request: URL;
  try {
    request = new URL(requested);
  } catch {
    return "It is not an absolute URL.";
  }
  const trim = (value: string) => value.replace(/\/+$/, "");
  for (const uri of registered) {
    let entry: URL;
    try {
      entry = new URL(uri);
    } catch {
      continue;
    }
    if (trim(uri) === trim(requested)) return `Only a trailing slash differs from ${uri}.`;
    if (entry.host === request.host && entry.pathname === request.pathname) {
      if (entry.protocol !== request.protocol) return `Only the scheme differs from ${uri}.`;
      if (entry.search !== request.search) return `Only the query string differs from ${uri}.`;
    }
    if (entry.hostname === request.hostname && entry.pathname === request.pathname)
      return `Only the port differs from ${uri}. Ports may vary only on 127.0.0.1 or [::1], not localhost.`;
    if (
      entry.pathname === request.pathname &&
      entry.port === request.port &&
      new Set([entry.hostname, request.hostname]).size === 2 &&
      [entry.hostname, request.hostname].every((host) => host === "localhost" || isLoopbackIp(host))
    )
      return `Only the loopback host differs from ${uri}: localhost, 127.0.0.1 and [::1] are different URIs.`;
  }
  return null;
}

/** Problems with a pooled client's settings, worst first. */
export function diagnoseClient(client: OidcClientSummary, context: DiagnosisContext): Finding[] {
  const { list, error, warning, info } = findings();
  const signIn = client.grantTypes.includes("authorization_code");
  const service = client.grantTypes.includes("client_credentials");

  if (client.disabled)
    error("The application is disabled: authorization requests fail with `client_disabled`.");
  if (!signIn && !service)
    error(
      "It has neither the authorization_code nor the client_credentials grant, so it can get no token.",
    );

  if (signIn) {
    if (!client.redirectUris.length)
      error(
        "It signs people in but has no redirect URI, so every sign-in fails with `invalid_redirect`.",
      );
    for (const uri of client.redirectUris) {
      const problem = validateRedirectUri(uri, client.applicationType);
      if (problem) error(`Redirect URI ${uri}: ${problem}`);
    }
    for (const uri of client.postLogoutRedirectUris) {
      const problem = validateRedirectUri(uri, client.applicationType);
      if (problem) warning(`Post-logout redirect URI ${uri}: ${problem}`);
    }
    if (!client.scopes.includes("openid"))
      warning("openid is not among its scopes, so it gets no ID token and cannot call UserInfo.");
    const offline = client.scopes.includes("offline_access");
    const refresh = client.grantTypes.includes("refresh_token");
    if (offline && !refresh)
      warning(
        "It may ask for offline_access but lacks the refresh_token grant, so refreshing fails with `unauthorized_client`.",
      );
    if (refresh && !offline)
      warning(
        "It has the refresh_token grant but may not ask for offline_access, so it is never given a refresh token.",
      );
    if (client.postLogoutRedirectUris.length && !client.enableEndSession)
      warning(
        "Post-logout redirect URIs are registered but sign-out is off: `/oauth2/end-session` answers `invalid_client`.",
      );
    if (client.enableEndSession && !client.postLogoutRedirectUris.length)
      info(
        "Sign-out through `/oauth2/end-session` works, but it cannot send people back: no post-logout redirect URI is registered.",
      );
  }

  if (service && !client.clientCredentialsScopes.length)
    error(
      "It uses client credentials without any scope for them, so token requests fail with `invalid_scope`.",
    );

  if (client.credential === "public")
    info(
      "Public client: no secret, PKCE with S256 on every sign-in, and no client credentials grant.",
    );
  else if (client.credential === "secret")
    info(
      "Confidential client using client_secret_basic: send the client ID and secret as HTTP Basic credentials to the token endpoint.",
    );
  else {
    try {
      const { keys } = parsePublicJwks(client.jwks ?? "");
      const described = keys.map((key) =>
        [key.kid, key.kty, key.crv]
          .map((field) => (typeof field === "string" ? field : "?"))
          .join(" "),
      );
      info(`Authenticates with private_key_jwt. Registered public keys: ${described.join(", ")}.`);
      if (keys.length > 1 && keys.some((key) => key.kid === undefined))
        warning(
          "Several keys are registered and some have no kid, so a client assertion's key may be ambiguous.",
        );
    } catch (cause) {
      error(`Its public JWKS is unusable: ${(cause as Error).message}`);
    }
  }
  if (signIn) info("PKCE with S256 is required on every authorization request.");

  const granted = [...client.scopes.filter(isApiScope), ...client.clientCredentialsScopes];
  for (const key of resourcesForScopes(granted)) {
    const identifier = context.resources[key];
    if (!identifier)
      error(`It holds ${key} API scopes, but this deployment configures no ${key} resource.`);
    else if (!client.resourceIds.includes(identifier))
      error(
        `It holds ${key} API scopes but is not linked to ${identifier}, so requests naming that resource fail with \`invalid_target\`. Saving it as Master Admin links it.`,
      );
  }
  const configured = Object.values(context.resources);
  for (const identifier of client.resourceIds)
    if (!configured.includes(identifier))
      warning(`It is linked to ${identifier}, which this deployment no longer configures.`);

  if (client.skipConsent) info("Consent is skipped: people are never asked to approve it.");
  if (client.restricted) info("It has API access, so only Master Admin may change it.");
  if (!client.authorizedUsers) info("Nobody has authorized it yet.");

  const order = { error: 0, warning: 1, info: 2 };
  return list.sort((a, b) => order[a.level] - order[b.level]);
}

/**
 * Checks an authorization request the way `/oauth2/authorize` would, in the same order, and
 * says what the client would get back. `request` is a full authorization URL or its query.
 */
/** A protected resource's token policy, as the provider stores it. */
export type ResourcePolicy = { allowedScopes: string[] | null; disabled: boolean };

export function checkAuthorizationRequest(
  client: OidcClientSummary,
  request: string,
  context: {
    authorizeEndpoint: string;
    /** Every resource the provider knows, by identifier. */
    resourcePolicies: Record<string, ResourcePolicy>;
  },
): Finding[] {
  const { list, error, warning, info } = findings();
  let params: URLSearchParams;
  try {
    const url = new URL(request);
    params = url.searchParams;
    const expected = new URL(context.authorizeEndpoint);
    if (url.origin !== expected.origin || url.pathname !== expected.pathname)
      error(
        `It goes to ${url.origin}${url.pathname}, not the authorization endpoint ${context.authorizeEndpoint}.`,
      );
  } catch {
    params = new URLSearchParams(request.replace(/^\?/, ""));
  }
  const value = (name: string) => params.get(name) ?? undefined;

  const clientId = value("client_id");
  if (!clientId) error("client_id is missing.");
  else if (clientId !== client.clientId)
    error(`client_id is ${clientId}, not this application's ${client.clientId}.`);
  const responseType = value("response_type");
  if (!responseType) error("response_type is missing: send response_type=code.");
  else if (responseType !== "code")
    error(
      `response_type=${responseType} is unsupported (\`unsupported_response_type\`): only code is.`,
    );
  if (client.disabled) error("The application is disabled (`client_disabled`).");
  if (!client.grantTypes.includes("authorization_code"))
    error("It may not use the authorization_code grant (`unauthorized_client`).");

  const redirectUri = value("redirect_uri");
  if (!redirectUri)
    error("redirect_uri is missing (`invalid_redirect`). It is required on every request.");
  else if (!matchRedirectUri(client.redirectUris, redirectUri)) {
    const hint = nearMiss(client.redirectUris, redirectUri);
    error(
      `redirect_uri ${redirectUri} is not registered (\`invalid_redirect\`).${hint ? ` ${hint}` : ""}`,
    );
  }

  const scope = value("scope");
  const scopes = scope ? scope.split(" ").filter(Boolean) : [...client.scopes];
  if (!scope)
    info(`No scope was sent, so the application's scopes apply: ${client.scopes.join(" ")}.`);
  const unknown = scopes.filter((entry) => !client.scopes.includes(entry));
  if (unknown.length)
    error(`These scopes are not allowed for it (\`invalid_scope\`): ${unknown.join(", ")}.`);
  if (value("claims") !== undefined && !scopes.includes("openid"))
    error("The claims parameter needs the openid scope (`invalid_request`).");

  const resources = [...new Set(params.getAll("resource"))];
  // The token carries only the scopes every requested resource allows, and none is refused.
  let granted = scopes;
  for (const resource of resources) {
    const policy = context.resourcePolicies[resource];
    if (!policy) error(`resource ${resource} is not configured here (\`invalid_target\`).`);
    else if (policy.disabled) error(`resource ${resource} is disabled (\`invalid_target\`).`);
    else if (!client.resourceIds.includes(resource))
      error(`The application is not linked to resource ${resource} (\`invalid_target\`).`);
    else if (policy.allowedScopes) {
      const allowed = policy.allowedScopes;
      const kept = granted.filter((entry) => allowed.includes(entry));
      if (!kept.length)
        error(
          `None of the requested scopes are allowed for resource ${resource} (\`invalid_scope\`); it accepts ${allowed.join(" ")}.`,
        );
      else if (kept.length < granted.length)
        info(`The token for ${resource} carries only: ${kept.join(" ")}.`);
      granted = kept;
    }
  }
  if (!resources.length && scopes.some(isApiScope))
    warning(
      "It asks for API scopes without a resource parameter, so the access token is opaque and addressed to no API.",
    );

  const challenge = value("code_challenge");
  const method = value("code_challenge_method");
  if (!challenge || !method)
    error(
      "PKCE is missing: send code_challenge with code_challenge_method=S256 (`invalid_request`).",
    );
  else if (method !== "S256")
    error(`code_challenge_method=${method} is unsupported: only S256 is (\`invalid_request\`).`);
  if (!value("state"))
    warning("state is missing, so the application cannot tie the response to its own request.");
  if (scopes.includes("openid") && !value("nonce"))
    info("No nonce: the ID token carries none for the application to check.");
  if (scopes.includes("offline_access") && !client.grantTypes.includes("refresh_token"))
    warning(
      "offline_access is requested but the refresh_token grant is missing, so no refresh token is usable.",
    );
  const prompt = value("prompt");
  if (prompt?.split(" ").includes("select_account"))
    error("prompt=select_account is not supported (`unsupported_prompt_select_account`).");

  if (!list.some((finding) => finding.level === "error"))
    info("The provider would accept this request and continue to sign-in and consent.");
  return list;
}

/** The shortest path from `start` to `target` along `next`, both ends included, or null. */
function shortestPath(start: string, target: string, next: (key: string) => readonly string[]) {
  const previous = new Map<string, string | null>([[start, null]]);
  const queue = [start];
  while (queue.length) {
    const key = queue.shift()!;
    if (key === target) {
      const path = [key];
      for (let step = previous.get(key); step; step = previous.get(step)) path.unshift(step);
      return path;
    }
    for (const following of next(key))
      if (!previous.has(following)) {
        previous.set(following, key);
        queue.push(following);
      }
  }
  return null;
}

export type PermissionSource = {
  /** A role the person holds directly: given by hand, proven by their accounts, or Master Admin. */
  heldRole: string;
  /** From the held role up the inheritance chain to the role that grants the permission. */
  rolePath: string[];
  /** From the permission that role grants down the implications to the one asked about. */
  permissionPath: string[];
};

/**
 * Why someone holds a permission: every way one of the roles they hold directly leads to it,
 * through role inheritance and then permission implications. Empty when they do not hold it.
 * Master Admin holds everything without a path.
 */
export function explainPermission(
  catalog: RbacCatalog,
  directRoles: readonly string[],
  permission: string,
): PermissionSource[] {
  const roles = new Map(catalog.roles.map((entry) => [entry.key, entry]));
  const permissions = new Map(catalog.permissions.map((entry) => [entry.key, entry]));
  if (!permissions.has(permission)) return [];
  if (directRoles.includes(MASTER_ADMIN_ROLE_KEY))
    return [
      {
        heldRole: MASTER_ADMIN_ROLE_KEY,
        rolePath: [MASTER_ADMIN_ROLE_KEY],
        permissionPath: [permission],
      },
    ];
  const parents = (key: string) =>
    (roles.get(key)?.parents ?? []).filter((parent) => parent !== MASTER_ADMIN_ROLE_KEY);
  const implies = (key: string) => permissions.get(key)?.implies ?? [];
  const sources: PermissionSource[] = [];
  for (const heldRole of directRoles) {
    for (const role of catalog.roles) {
      const rolePath = shortestPath(heldRole, role.key, parents);
      if (!rolePath) continue;
      for (const granted of role.permissions) {
        const permissionPath = shortestPath(granted, permission, implies);
        if (permissionPath) sources.push({ heldRole, rolePath, permissionPath });
      }
    }
  }
  return sources;
}
