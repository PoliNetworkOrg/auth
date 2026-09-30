import { createFileRoute } from "@tanstack/react-router";
import { apiError, noStore, requireIdpPermission } from "@/auth/api-guard";
import { RbacError } from "@/auth/rbac-store";
import { listUsers } from "@/auth/user-directory";
import { parseUserSearch } from "@/auth/users";

export const Route = createFileRoute("/api/users/")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const guard = await requireIdpPermission(request, "idp:users:read");
        if ("response" in guard) return guard.response;
        const search = parseUserSearch(new URL(request.url).searchParams);
        try {
          return Response.json(await listUsers(guard.session.userId, search), {
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
