import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { apiError, noStore, requireIdpPermission } from "@/auth/api-guard";
import { RbacError } from "@/auth/rbac-store";
import { deleteUser } from "@/auth/user-deletion";
import { getUserDetail } from "@/auth/user-directory";

const deleteSchema = z.object({ action: z.literal("delete"), confirm: z.string().max(200) });

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
      POST: async ({ request, params }) => {
        const guard = await requireIdpPermission(request, "idp:users:delete", { write: true });
        if ("response" in guard) return guard.response;
        const parsed = deleteSchema.safeParse(await request.json().catch(() => null));
        if (!parsed.success) return apiError(400, "Invalid request.");
        try {
          await deleteUser(guard.session.userId, params.userId, parsed.data.confirm);
          return Response.json({ deleted: true }, { headers: noStore });
        } catch (cause) {
          if (cause instanceof RbacError) return apiError(cause.status, cause.message);
          throw cause;
        }
      },
    },
  },
});
