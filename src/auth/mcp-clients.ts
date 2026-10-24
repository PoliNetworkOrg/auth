// Shared by the server and the browser: keep this file free of server-only imports.

/** Where the MCP server answers, on the public origin. */
export const MCP_PATH = "/api/mcp";

/** The scope every MCP access token carries, named after the permission that gates it. */
export const MCP_SCOPE = "idp:mcp";

/**
 * Everything a self-registered MCP client may ask for: `offline_access` lets it refresh.
 * Without `openid` it gets no ID token and cannot call UserInfo, so anonymous registration
 * never turns into a way to sign people in elsewhere or read their profile.
 */
export const MCP_CLIENT_SCOPES = ["offline_access", MCP_SCOPE];

/**
 * Callback pages of hosted agents, matched exactly. A self-registered client may otherwise
 * only redirect to the person's own machine, where an attacker who tricks someone into
 * approving a client cannot collect the code.
 */
export const HOSTED_MCP_CALLBACKS = [
  "https://claude.ai/api/mcp/auth_callback",
  "https://claude.com/api/mcp/auth_callback",
  "https://chatgpt.com/connector_platform_oauth_redirect",
  "https://vscode.dev/redirect",
  "https://insiders.vscode.dev/redirect",
];

/**
 * The part of a requested scope string an MCP client may have, or null when that is nothing.
 * Agents often ask for every scope the authorization server lists; the server may grant
 * fewer than asked (RFC 6749 §3.3), and the token response tells the agent what it got.
 */
export function narrowMcpScope(requested: unknown, allowed: readonly string[]) {
  if (typeof requested !== "string") return null;
  const kept = [...new Set(requested.split(" ").filter((scope) => allowed.includes(scope)))];
  return kept.length ? kept.join(" ") : null;
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** `http://localhost`, `http://127.0.0.1` or `http://[::1]`, on any port and path. */
export function isLoopbackRedirect(uri: string) {
  try {
    const url = new URL(uri);
    return (
      url.protocol === "http:" &&
      LOOPBACK_HOSTS.has(url.hostname) &&
      !url.username &&
      !url.password &&
      !uri.includes("#")
    );
  } catch {
    return false;
  }
}

const AUTH_METHODS = ["none", "client_secret_basic", "client_secret_post"];
const GRANT_TYPES = ["authorization_code", "refresh_token"];

export type McpRegistration = {
  /** Why the registration is refused, or null when it may go ahead. */
  problem: string | null;
  /** The application type to register with, when the client left it out. */
  applicationType: "web" | "native";
  /** The requested scopes it may have; every MCP client gets `MCP_CLIENT_SCOPES` anyway. */
  scope: string;
};

/**
 * Whether an anonymous dynamic client registration is one an MCP agent would make: it signs
 * people in with the authorization code flow, redirects only to the person's machine or a
 * hosted agent, and carries no keys. Better Auth checks the rest of the metadata afterwards,
 * and limits the scopes and resources to the MCP server's.
 */
export function checkMcpRegistration(body: Record<string, unknown> | undefined): McpRegistration {
  const scope = narrowMcpScope(body?.scope, MCP_CLIENT_SCOPES) ?? MCP_CLIENT_SCOPES.join(" ");
  const refuse = (problem: string): McpRegistration => ({
    problem,
    applicationType: "native",
    scope,
  });
  const redirects = body?.redirect_uris;
  if (!Array.isArray(redirects) || redirects.length === 0 || redirects.length > 10)
    return refuse("Register between one and ten redirect URIs.");
  if (redirects.some((uri) => typeof uri !== "string"))
    return refuse("Redirect URIs must be strings.");
  const loopback = redirects.filter((uri: string) => isLoopbackRedirect(uri));
  const hosted = redirects.filter((uri: string) => HOSTED_MCP_CALLBACKS.includes(uri));
  if (loopback.length + hosted.length !== redirects.length)
    return refuse(
      "MCP clients may only redirect to http://localhost, http://127.0.0.1, http://[::1], or a known hosted agent.",
    );
  const grants = body?.grant_types ?? ["authorization_code"];
  if (
    !Array.isArray(grants) ||
    !grants.includes("authorization_code") ||
    grants.some((grant) => typeof grant !== "string" || !GRANT_TYPES.includes(grant.trim()))
  )
    return refuse("MCP clients use the authorization code grant, with refresh tokens if needed.");
  const method = body?.token_endpoint_auth_method ?? "client_secret_basic";
  if (typeof method !== "string" || !AUTH_METHODS.includes(method.trim()))
    return refuse("MCP clients authenticate with a client secret or as public clients.");
  if (body?.jwks !== undefined || body?.jwks_uri !== undefined)
    return refuse("MCP clients cannot register keys.");
  // Better Auth would read a missing type as "web", which refuses loopback redirects.
  const declared = body?.application_type;
  const applicationType =
    declared === "web" || declared === "native" ? declared : loopback.length ? "native" : "web";
  if (applicationType === "web" && loopback.length)
    return refuse("Loopback redirect URIs need the native application type.");
  return { problem: null, applicationType, scope };
}

/** The name agents list the server under. */
export const MCP_SERVER_NAME = "polinetwork-auth";

/** Ready-to-paste commands that add the server at `serverUrl` to the common agents. */
export function mcpSetupCommands(serverUrl: string) {
  const vscode = JSON.stringify({ name: MCP_SERVER_NAME, type: "http", url: serverUrl });
  return [
    {
      id: "claude",
      label: "Claude Code",
      command: `claude mcp add --scope user --transport http ${MCP_SERVER_NAME} ${serverUrl}`,
    },
    { id: "codex", label: "Codex", command: `codex mcp add ${MCP_SERVER_NAME} --url ${serverUrl}` },
    {
      id: "gemini",
      label: "Gemini CLI",
      command: `gemini mcp add --scope user --transport http ${MCP_SERVER_NAME} ${serverUrl}`,
    },
    { id: "vscode", label: "VS Code", command: `code --add-mcp '${vscode}'` },
  ];
}
