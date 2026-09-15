import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { apiError, noStore, requireAdministrator } from "@/auth/api-guard";
import { RbacError, assignRole, listRoleMembers, unassignRole } from "@/auth/rbac-store";

const inputSchema = z.object({
  action: z.enum(["assign", "unassign"]),
  roleId: z.string().min(1),
  userId: z.string().min(1),
});

export const Route = createFileRoute("/api/rbac/role-members")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const guard = await requireAdministrator(request);
        if ("response" in guard) return guard.response;
        const roleId = new URL(request.url).searchParams.get("role_id");
        if (!roleId) return apiError(400, "Name the role to list.");
        try {
          return Response.json(await listRoleMembers(roleId), { headers: noStore });
        } catch (cause) {
          if (cause instanceof RbacError) return apiError(cause.status, cause.message);
          throw cause;
        }
      },
      POST: async ({ request }) => {
        const guard = await requireAdministrator(request, { write: true });
        if ("response" in guard) return guard.response;
        const parsed = inputSchema.safeParse(await request.json().catch(() => null));
        if (!parsed.success) return apiError(400, "Invalid request.");
        const { action, roleId, userId } = parsed.data;
        try {
          if (action === "assign") await assignRole(roleId, userId, guard.session.userId);
          else await unassignRole(roleId, userId);
          return Response.json(await listRoleMembers(roleId), { headers: noStore });
        } catch (cause) {
          if (cause instanceof RbacError) return apiError(cause.status, cause.message);
          throw cause;
        }
      },
    },
  },
});
