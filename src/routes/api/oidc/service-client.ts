import { createFileRoute } from "@tanstack/react-router";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { auth } from "@/auth";
import { apiError, noStore, requireIdpPermission } from "@/auth/api-guard";
import { canAdministerIdp } from "@/auth/oidc-admin";
import { RbacError, withAuthorizedRbacWrite } from "@/auth/rbac-store";
import { MASTER_ADMIN_ROLE_KEY } from "@/auth/rbac";
import { isServiceClient } from "@/auth/service-client-policy";
import { ServiceJwksError, validateServiceJwks } from "@/auth/service-jwks";
import { OIDC_CLIENT_REFERENCE } from "@/auth/oidc-clients";
import { SERVICE_CLIENT_TEMPLATES } from "@/auth/service-client-templates";
import { db } from "@/db";
import { oauthClient } from "@/db/schema";
import { env } from "@/env";

const inputSchema = z.object({
  kind: z.enum(["telegram-bot", "website", "admin-dashboard", "backend"]),
  jwks: z.object({ keys: z.array(z.record(z.string(), z.unknown())).min(1).max(5) }),
  redirectUri: z.url().optional(),
});
const updateSchema = z.object({
  clientId: z.string().min(1),
  jwks: z.object({ keys: z.array(z.record(z.string(), z.unknown())).min(1).max(5) }),
});

export const Route = createFileRoute("/api/oidc/service-client")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const guard = await requireIdpPermission(request, "idp:applications:write", {
          write: true,
        });
        if ("response" in guard) return guard.response;
        if (!(await canAdministerIdp(guard.session.userId, db, true)))
          return apiError(403, "Only Master Admin may register service clients.");
        const parsed = inputSchema.safeParse(await request.json().catch(() => null));
        if (!parsed.success) return apiError(400, "Invalid service-client details.");
        const { kind, jwks, redirectUri } = parsed.data;
        const template = SERVICE_CLIENT_TEMPLATES[kind];
        const resource =
          template.resource === "backend"
            ? env.OAUTH_BACKEND_RESOURCE_URI
            : env.OAUTH_INTERNAL_RESOURCE_URI;
        if (!resource) return apiError(503, "OAuth resources are not configured.");
        if (template.interactive && !redirectUri)
          return apiError(400, "The dashboard redirect URI is required.");
        try {
          await validateServiceJwks(jwks, db);
        } catch (error) {
          if (error instanceof ServiceJwksError) return apiError(error.status, error.message);
          throw error;
        }

        let clientId: string;
        try {
          const created = await auth.api.adminCreateOAuthClient({
            headers: request.headers,
            body: {
              client_name: template.name,
              token_endpoint_auth_method: "private_key_jwt",
              jwks,
              grant_types: template.interactive
                ? ["authorization_code", "refresh_token"]
                : ["client_credentials"],
              scope: template.scopes.join(" "),
              subject_type: "public",
              ...(template.interactive
                ? {
                    redirect_uris: [redirectUri!],
                    response_types: ["code" as const],
                    enable_end_session: true,
                    require_pkce: true,
                  }
                : { client_credentials_scopes: [...template.scopes] }),
            },
          });
          clientId = created.client_id;
        } catch {
          return apiError(
            400,
            "Unable to register this service client. Check its public key and redirect URI.",
          );
        }

        let linked = false;
        try {
          const result = await auth.api.adminLinkClientResource({
            headers: request.headers,
            params: { identifier: resource, client_id: clientId },
          });
          linked = result.linked;
        } catch {
          // Return the new client ID so the administrator can retry the resource link.
        }
        return Response.json({ clientId, linked }, { status: 201, headers: noStore });
      },
      PATCH: async ({ request }) => {
        const guard = await requireIdpPermission(request, "idp:applications:write", {
          write: true,
        });
        if ("response" in guard) return guard.response;
        const parsed = updateSchema.safeParse(await request.json().catch(() => null));
        if (!parsed.success) return apiError(400, "Invalid public JWKS.");
        try {
          const result = await withAuthorizedRbacWrite(
            guard.session.userId,
            "idp:applications:write",
            async (transaction, _catalog, access) => {
              if (!access.roles.includes(MASTER_ADMIN_ROLE_KEY))
                throw new RbacError(403, "Only Master Admin may rotate service keys.");
              const [client] = await transaction
                .select({
                  id: oauthClient.id,
                  tokenEndpointAuthMethod: oauthClient.tokenEndpointAuthMethod,
                  clientCredentialsScopes: oauthClient.clientCredentialsScopes,
                  scopes: oauthClient.scopes,
                })
                .from(oauthClient)
                .where(
                  and(
                    eq(oauthClient.clientId, parsed.data.clientId),
                    eq(oauthClient.referenceId, OIDC_CLIENT_REFERENCE),
                  ),
                );
              if (!client || !isServiceClient(client))
                throw new RbacError(404, "Service client not found.");
              await validateServiceJwks(parsed.data.jwks, transaction, parsed.data.clientId);
              await transaction.execute(
                sql`select set_config('polinetwork.actor_id', ${guard.session.userId}, true)`,
              );
              const jwks = JSON.stringify(parsed.data.jwks);
              await transaction
                .update(oauthClient)
                .set({ jwks, updatedAt: new Date() })
                .where(eq(oauthClient.id, client.id));
              return { jwks };
            },
          );
          return Response.json(result, { headers: noStore });
        } catch (error) {
          if (error instanceof ServiceJwksError || error instanceof RbacError)
            return apiError(error.status, error.message);
          throw error;
        }
      },
    },
  },
});
