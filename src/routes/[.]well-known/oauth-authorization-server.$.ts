import { oauthProviderAuthServerMetadata } from "@better-auth/oauth-provider";
import { createFileRoute } from "@tanstack/react-router";
import { auth } from "@/auth";

const metadata = oauthProviderAuthServerMetadata(auth, {
  headers: { "Access-Control-Allow-Origin": "*" },
});

/**
 * The authorization server metadata where RFC 8414 puts it for an issuer with a path
 * (`/.well-known/oauth-authorization-server/api/auth`), which MCP agents try first, and at
 * the root, where agents from before protected resource metadata look.
 */
export const Route = createFileRoute("/.well-known/oauth-authorization-server/$")({
  server: {
    handlers: {
      GET: ({ params, request }) =>
        !params._splat || params._splat === "api/auth"
          ? metadata(request)
          : Response.json({ error: "not_found" }, { status: 404 }),
    },
  },
});
