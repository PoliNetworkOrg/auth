import { createFileRoute } from "@tanstack/react-router";
import { noStore, requireIdpPermission } from "@/auth/api-guard";
import { listOidcClients } from "@/auth/oidc-registry";

export const Route = createFileRoute("/api/oidc/clients")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const guard = await requireIdpPermission(request, "idp:applications:read");
        if ("response" in guard) return guard.response;
        const clientId = new URL(request.url).searchParams.get("client_id") ?? undefined;
        return Response.json(await listOidcClients(guard.session.userId, clientId), {
          headers: noStore,
        });
      },
    },
  },
});
