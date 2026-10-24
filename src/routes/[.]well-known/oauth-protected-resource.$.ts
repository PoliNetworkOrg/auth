import { createFileRoute } from "@tanstack/react-router";
import { MCP_PATH, MCP_SCOPE } from "@/auth/mcp-clients";
import { issuer, mcpResource } from "@/auth/mcp-resource";

/**
 * The MCP server's protected resource metadata (RFC 9728), at the path-suffixed location and
 * at the root for agents that look there. It names this identity provider as the server that
 * signs agents in, and the scopes to ask for.
 */
export const Route = createFileRoute("/.well-known/oauth-protected-resource/$")({
  server: {
    handlers: {
      GET: ({ params }) => {
        if (params._splat && `/${params._splat}` !== MCP_PATH)
          return Response.json({ error: "not_found" }, { status: 404 });
        return Response.json(
          {
            resource: mcpResource,
            authorization_servers: [issuer],
            scopes_supported: [MCP_SCOPE, "offline_access"],
            bearer_methods_supported: ["header"],
            resource_name: "PoliNetwork Auth",
          },
          {
            headers: {
              "Access-Control-Allow-Origin": "*",
              "Cache-Control": "public, max-age=3600",
            },
          },
        );
      },
    },
  },
});
