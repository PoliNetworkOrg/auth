import { createFileRoute } from "@tanstack/react-router";
import { noStore, requireAdministrator } from "@/auth/api-guard";
import { loadCatalog } from "@/auth/rbac-store";

export const Route = createFileRoute("/api/rbac/catalog")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const guard = await requireAdministrator(request);
        if ("response" in guard) return guard.response;
        return Response.json(await loadCatalog(), { headers: noStore });
      },
    },
  },
});
