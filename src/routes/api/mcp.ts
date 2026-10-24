import { createMcpHandler } from "@modelcontextprotocol/server";
import { createFileRoute } from "@tanstack/react-router";
import { logAuthorizationDenial } from "@/auth/denial-log";
import { getIdentity } from "@/auth/identity";
import { MCP_SCOPE } from "@/auth/mcp-clients";
import { mcpResource, mcpResourceMetadataUrl } from "@/auth/mcp-resource";
import { createMcpServer, type McpPrincipal } from "@/auth/mcp-server";
import { verifyMcpToken } from "@/auth/mcp-token";
import { MANAGED_PERMISSION_KEYS } from "@/auth/rbac";

const headers = { "Cache-Control": "no-store" };

// Every request is answered by a fresh server built for its principal, without sessions:
// the agent's token and the person's permissions are checked on each one.
const handler = createMcpHandler(
  ({ authInfo }) => createMcpServer(authInfo?.extra?.principal as McpPrincipal),
  { onerror: (error) => console.error("MCP request failed", error) },
);

/**
 * The RFC 6750 challenge that sends an agent to the protected resource metadata, and from
 * there to sign-in. It asks for offline access so the agent can refresh instead of making
 * the person sign in again every few minutes.
 */
function unauthorized(error?: string) {
  const challenge = [
    `resource_metadata="${mcpResourceMetadataUrl}"`,
    `scope="${MCP_SCOPE} offline_access"`,
    ...(error ? [`error="${error}"`] : []),
  ].join(", ");
  return Response.json(
    { error: error ?? "unauthorized", error_description: "Sign in to use the MCP server." },
    { status: 401, headers: { ...headers, "WWW-Authenticate": `Bearer ${challenge}` } },
  );
}

async function handle(request: Request) {
  const authorization = request.headers.get("authorization");
  const caller = await verifyMcpToken(authorization);
  if (!caller) return unauthorized(authorization ? "invalid_token" : undefined);
  let identity: Awaited<ReturnType<typeof getIdentity>>;
  try {
    identity = await getIdentity(caller.userId);
  } catch {
    return Response.json(
      { error: "temporarily_unavailable", error_description: "Authorization unavailable." },
      { status: 503, headers },
    );
  }
  // Checked on every request, so taking the permission away ends access at once.
  if (!identity.permissions.includes(MCP_SCOPE)) {
    logAuthorizationDenial(caller.userId, "mcp", [MCP_SCOPE]);
    return Response.json(
      {
        error: "access_denied",
        error_description: `Your account needs the ${MCP_SCOPE} permission to use the MCP server.`,
      },
      { status: 403, headers },
    );
  }
  const principal: McpPrincipal = {
    userId: caller.userId,
    clientId: caller.clientId,
    permissions: identity.permissions.filter((key) => MANAGED_PERMISSION_KEYS.includes(key)),
    roles: identity.roles,
  };
  const response = await handler.fetch(request, {
    authInfo: {
      token: caller.token,
      clientId: caller.clientId,
      scopes: caller.scopes,
      expiresAt: caller.expiresAt,
      resource: new URL(mcpResource),
      extra: { principal },
    },
  });
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export const Route = createFileRoute("/api/mcp")({
  server: {
    handlers: {
      GET: ({ request }) => handle(request),
      POST: ({ request }) => handle(request),
      DELETE: ({ request }) => handle(request),
    },
  },
});
