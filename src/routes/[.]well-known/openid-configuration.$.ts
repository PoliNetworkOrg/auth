import { oauthProviderOpenIdConfigMetadata } from "@better-auth/oauth-provider";
import { createFileRoute } from "@tanstack/react-router";
import { auth } from "@/auth";

const metadata = oauthProviderOpenIdConfigMetadata(auth, {
  headers: { "Access-Control-Allow-Origin": "*" },
});

/**
 * OpenID Connect discovery with the issuer's path appended to the well-known path, which MCP
 * agents try before `/api/auth/.well-known/openid-configuration`. Only the issuer's own path
 * is answered: the root would describe an issuer that does not exist.
 */
export const Route = createFileRoute("/.well-known/openid-configuration/$")({
  server: {
    handlers: {
      GET: ({ params, request }) =>
        params._splat === "api/auth"
          ? metadata(request)
          : Response.json({ error: "not_found" }, { status: 404 }),
    },
  },
});
