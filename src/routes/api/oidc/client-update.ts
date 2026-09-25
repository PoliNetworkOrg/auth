import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { noStore, requireIdpPermission } from "@/auth/api-guard";
import { hasDraftErrors, normalizeClientDraft, validateClientDraft } from "@/auth/oidc-clients";
import { updateOidcClient } from "@/auth/oidc-registry";

const draftSchema = z.object({
  name: z.string(),
  uri: z.string(),
  logo: z.string(),
  redirectUris: z.array(z.string()).max(50),
  postLogoutRedirectUris: z.array(z.string()).max(50),
  contacts: z.array(z.string()).max(20),
  tosUri: z.string(),
  policyUri: z.string(),
  scopes: z.array(z.string()).max(10),
  applicationType: z.enum(["web", "native"]),
});

const inputSchema = z.object({
  clientId: z.string().min(1),
  draft: draftSchema.optional(),
  disabled: z.boolean().optional(),
  skipConsent: z.boolean().optional(),
});

export const Route = createFileRoute("/api/oidc/client-update")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const guard = await requireIdpPermission(request, "idp:applications:write", {
          write: true,
        });
        if ("response" in guard) return guard.response;
        const parsed = inputSchema.safeParse(await request.json().catch(() => null));
        if (!parsed.success)
          return Response.json({ error: "Invalid request." }, { status: 400, headers: noStore });
        const { clientId, disabled, skipConsent } = parsed.data;
        let draft;
        if (parsed.data.draft) {
          draft = normalizeClientDraft(parsed.data.draft);
          const fields = validateClientDraft(draft);
          if (hasDraftErrors(fields))
            return Response.json(
              { error: "Check the highlighted fields.", fields },
              { status: 400, headers: noStore },
            );
        }
        const client = await updateOidcClient(guard.session.userId, clientId, {
          draft,
          disabled,
          skipConsent,
        });
        if (!client)
          return Response.json(
            { error: "Application not found." },
            { status: 404, headers: noStore },
          );
        return Response.json(client, { headers: noStore });
      },
    },
  },
});
