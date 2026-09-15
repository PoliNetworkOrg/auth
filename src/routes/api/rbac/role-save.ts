import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { apiError, noStore, requireAdministrator } from "@/auth/api-guard";
import { RbacError, deleteRole, saveRole } from "@/auth/rbac-store";

const draftSchema = z.object({
  key: z.string(),
  name: z.string(),
  description: z.string(),
  parents: z.array(z.string()).max(50),
  permissions: z.array(z.string()).max(200),
});

const inputSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create"), draft: draftSchema }),
  z.object({ action: z.literal("update"), roleId: z.string().min(1), draft: draftSchema }),
  z.object({ action: z.literal("delete"), roleId: z.string().min(1) }),
]);

export const Route = createFileRoute("/api/rbac/role-save")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const guard = await requireAdministrator(request, { write: true });
        if ("response" in guard) return guard.response;
        const parsed = inputSchema.safeParse(await request.json().catch(() => null));
        if (!parsed.success) return apiError(400, "Invalid request.");
        const input = parsed.data;
        try {
          if (input.action === "delete") {
            await deleteRole(input.roleId);
            return Response.json({ deleted: true }, { headers: noStore });
          }
          const saved = await saveRole(
            input.draft,
            input.action === "update" ? input.roleId : undefined,
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
