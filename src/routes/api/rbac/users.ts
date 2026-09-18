import { createFileRoute } from "@tanstack/react-router";
import { noStore, requireIdpPermission } from "@/auth/api-guard";
import { searchUsers } from "@/auth/rbac-store";

export const Route = createFileRoute("/api/rbac/users")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const guard = await requireIdpPermission(request, "idp:people:read");
        if ("response" in guard) return guard.response;
        const query = new URL(request.url).searchParams.get("q") ?? "";
        return Response.json(await searchUsers(guard.session.userId, query), { headers: noStore });
      },
    },
  },
});
