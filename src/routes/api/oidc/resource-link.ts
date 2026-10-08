import { and, eq } from "drizzle-orm";
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { apiError, noStore, requireIdpPermission } from "@/auth/api-guard";
import { auth } from "@/auth";
import { canAdministerIdp } from "@/auth/oidc-admin";
import { OIDC_CLIENT_REFERENCE } from "@/auth/oidc-clients";
import { db } from "@/db";
import { oauthClient } from "@/db/schema";
import { env } from "@/env";

const inputSchema = z.object({
  clientId: z.string().min(1),
  resource: z.enum(["backend", "internal"]),
});

export const Route = createFileRoute("/api/oidc/resource-link")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const guard = await requireIdpPermission(request, "idp:applications:write", {
          write: true,
        });
        if ("response" in guard) return guard.response;
        if (!(await canAdministerIdp(guard.session.userId, db, true)))
          return apiError(403, "Only Master Admin may link service resources.");
        const parsed = inputSchema.safeParse(await request.json().catch(() => null));
        if (!parsed.success) return apiError(400, "Invalid resource link.");
        const identifier =
          parsed.data.resource === "backend"
            ? env.OAUTH_BACKEND_RESOURCE_URI
            : env.OAUTH_INTERNAL_RESOURCE_URI;
        if (!identifier) return apiError(503, "OAuth resources are not configured.");
        const [client] = await db
          .select({ id: oauthClient.id })
          .from(oauthClient)
          .where(
            and(
              eq(oauthClient.clientId, parsed.data.clientId),
              eq(oauthClient.referenceId, OIDC_CLIENT_REFERENCE),
            ),
          );
        if (!client) return apiError(404, "Application not found.");
        try {
          await auth.api.adminLinkClientResource({
            headers: request.headers,
            params: { identifier, client_id: parsed.data.clientId },
          });
          return Response.json({ linked: true }, { headers: noStore });
        } catch {
          return apiError(502, "Unable to link the configured resource.");
        }
      },
    },
  },
});
