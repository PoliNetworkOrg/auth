import { createFileRoute } from "@tanstack/react-router";
import { apiError, noStore, requireIdpPermission } from "@/auth/api-guard";
import { RbacError } from "@/auth/rbac-store";
import { getUserDetail } from "@/auth/user-directory";

export const Route = createFileRoute("/api/users/$userId")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const guard = await requireIdpPermission(request, "idp:users:read");
        if ("response" in guard) return guard.response;
        try {
          return Response.json(await getUserDetail(guard.session.userId, params.userId), {
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
