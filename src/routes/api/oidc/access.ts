import { createFileRoute } from "@tanstack/react-router";
import { auth } from "@/auth";
import { canManageOidcClients, oidcAdminPolicy } from "@/auth/oidc-admin";

const noStore = { "Cache-Control": "no-store" };

export const Route = createFileRoute("/api/oidc/access")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const session = await auth.api.getSession({ headers: request.headers });
        if (!session)
          return Response.json({ error: "Unauthorized." }, { status: 401, headers: noStore });
        return Response.json(
          { allowed: await canManageOidcClients(session.user.id), policy: oidcAdminPolicy() },
          { headers: noStore },
        );
      },
    },
  },
});
