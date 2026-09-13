import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { auth } from "@/auth";
import { canManageOidcClients } from "@/auth/oidc-admin";
import { hasDraftErrors, normalizeClientDraft, validateClientDraft } from "@/auth/oidc-clients";
import { updateOidcClient } from "@/auth/oidc-registry";
import { env } from "@/env";

const noStore = { "Cache-Control": "no-store" };

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
        if (request.headers.get("origin") !== new URL(env.BETTER_AUTH_URL).origin)
          return Response.json({ error: "Invalid origin." }, { status: 403 });
        const session = await auth.api.getSession({ headers: request.headers });
        if (!session)
          return Response.json({ error: "Unauthorized." }, { status: 401, headers: noStore });
        if (!(await canManageOidcClients(session.user.id)))
          return Response.json(
            { error: "You cannot manage applications." },
            { status: 403, headers: noStore },
          );
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
        const client = await updateOidcClient(clientId, { draft, disabled, skipConsent });
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
