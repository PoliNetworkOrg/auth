import { createFileRoute } from "@tanstack/react-router";
import { noStore, requireIdpPermission } from "@/auth/api-guard";
import { loadCatalog } from "@/auth/rbac-store";

export const Route = createFileRoute("/api/rbac/catalog")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const guard = await requireIdpPermission(request, "idp:permissions:read");
        if ("response" in guard) return guard.response;
        return Response.json(await loadCatalog(), { headers: noStore });
      },
    },
  },
});
