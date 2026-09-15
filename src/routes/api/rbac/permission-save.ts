import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { apiError, noStore, requireIdpPermission } from "@/auth/api-guard";
import { RbacError, deletePermission, savePermission } from "@/auth/rbac-store";

const draftSchema = z.object({
  key: z.string(),
  name: z.string(),
  description: z.string(),
  implies: z.array(z.string()).max(50),
});

const inputSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create"), draft: draftSchema }),
  z.object({ action: z.literal("update"), permissionId: z.string().min(1), draft: draftSchema }),
  z.object({ action: z.literal("delete"), permissionId: z.string().min(1) }),
]);

export const Route = createFileRoute("/api/rbac/permission-save")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const guard = await requireIdpPermission(request, "idp:permissions:write", { write: true });
        if ("response" in guard) return guard.response;
        const parsed = inputSchema.safeParse(await request.json().catch(() => null));
        if (!parsed.success) return apiError(400, "Invalid request.");
        const input = parsed.data;
        try {
          if (input.action === "delete") {
            await deletePermission(input.permissionId);
            return Response.json({ deleted: true }, { headers: noStore });
          }
          const saved = await savePermission(
            input.draft,
            input.action === "update" ? input.permissionId : undefined,
          );
          return Response.json(saved, { headers: noStore });
        } catch (cause) {
          if (cause instanceof RbacError)
            return apiError(cause.status, cause.message, cause.fields);
          throw cause;
        }
      },
    },
  },
});
