import { createFileRoute } from "@tanstack/react-router";
import { auth } from "@/auth";
import { canManageOidcClients } from "@/auth/oidc-admin";
import { listOidcClients } from "@/auth/oidc-registry";

const noStore = { "Cache-Control": "no-store" };

export const Route = createFileRoute("/api/oidc/clients")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const session = await auth.api.getSession({ headers: request.headers });
        if (!session)
          return Response.json({ error: "Unauthorized." }, { status: 401, headers: noStore });
        if (!(await canManageOidcClients(session.user.id)))
          return Response.json(
            { error: "You cannot manage applications." },
            { status: 403, headers: noStore },
          );
        const clientId = new URL(request.url).searchParams.get("client_id") ?? undefined;
        return Response.json(await listOidcClients(clientId), { headers: noStore });
      },
    },
  },
});
