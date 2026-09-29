import { createFileRoute } from "@tanstack/react-router";
import { apiError, noStore, requireIdpPermission } from "@/auth/api-guard";
import { RbacError, searchUsers } from "@/auth/rbac-store";

export const Route = createFileRoute("/api/rbac/users")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const guard = await requireIdpPermission(request, "idp:people:read");
        if ("response" in guard) return guard.response;
        const params = new URL(request.url).searchParams;
        const query = params.get("q") ?? "";
        const roleId = params.get("role_id") ?? undefined;
        try {
          return Response.json(await searchUsers(guard.session.userId, query, roleId), {
            headers: noStore,
          });
        } catch (cause) {
          if (cause instanceof RbacError) return apiError(cause.status, cause.message);
          throw cause;
        }
      },
    },
  },
});
