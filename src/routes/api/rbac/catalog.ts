import { createFileRoute } from "@tanstack/react-router";
import { noStore, requireAnyIdpPermission } from "@/auth/api-guard";
import { catalogForIdpPermissions } from "@/auth/rbac";
import { loadCatalog } from "@/auth/rbac-store";

export const Route = createFileRoute("/api/rbac/catalog")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const guard = await requireAnyIdpPermission(request, [
          "idp:permissions:read",
          "idp:roles:read",
        ]);
        if ("response" in guard) return guard.response;
        const catalog = catalogForIdpPermissions(await loadCatalog(), guard.session.permissions);
        return Response.json(catalog, { headers: noStore });
      },
    },
  },
});
