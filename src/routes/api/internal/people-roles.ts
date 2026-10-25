import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { serviceClientId } from "@/auth/access-snapshot-token";
import { projectionForClient } from "@/auth/access-projections";
import { changePeopleRole, readPeopleDirectory } from "@/auth/people-roles";
import { RbacError } from "@/auth/rbac-store";
import { env } from "@/env";

const headers = { "Cache-Control": "private, no-store", Vary: "Authorization" };

const changeSchema = z.object({
  actor: z.string().min(1).max(200),
  sub: z.string().min(1).max(200),
  role: z.string().min(1).max(200),
  action: z.enum(["assign", "unassign"]),
  reason: z.string().trim().max(500),
});

/** Only the backend's own client, with the scope the request needs. */
async function backendClient(request: Request, scope: "idp:access:read" | "idp:people:roles") {
  if (!env.OAUTH_BACKEND_CLIENT_ID || !env.OAUTH_INTERNAL_RESOURCE_URI)
    return Response.json({ error: "Unavailable" }, { status: 503, headers });
  const clientId = await serviceClientId(request.headers.get("authorization"), scope);
  if (!clientId) return Response.json({ error: "Unauthorized" }, { status: 401, headers });
  if (projectionForClient(clientId) !== "backend")
    return Response.json({ error: "Forbidden" }, { status: 403, headers });
  return null;
}

/**
 * The roles Master Admin bound to People and who holds them (GET), and changes to them made
 * by the backend on behalf of a dashboard user (POST). See `src/auth/people-binding.ts` for
 * what the acting person needs.
 */
export const Route = createFileRoute("/api/internal/people-roles")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const refused = await backendClient(request, "idp:access:read");
        if (refused) return refused;
        return Response.json(await readPeopleDirectory(), { headers });
      },
      POST: async ({ request }) => {
        const refused = await backendClient(request, "idp:people:roles");
        if (refused) return refused;
        const parsed = changeSchema.safeParse(await request.json().catch(() => null));
        if (!parsed.success)
          return Response.json({ error: "Invalid request" }, { status: 400, headers });
        try {
          await changePeopleRole({
            actorId: parsed.data.actor,
            targetId: parsed.data.sub,
            roleKey: parsed.data.role,
            action: parsed.data.action,
            reason: parsed.data.reason,
          });
          return new Response(null, { status: 204, headers });
        } catch (error) {
          if (error instanceof RbacError)
            return Response.json({ error: error.message }, { status: error.status, headers });
          console.error(error);
          return Response.json({ error: "Unavailable" }, { status: 500, headers });
        }
      },
    },
  },
});
