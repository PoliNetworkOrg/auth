import { createFileRoute } from "@tanstack/react-router";
import { auth } from "@/auth";
import { noStore } from "@/auth/api-guard";
import { idpPermissions } from "@/auth/idp-access";
import { oidcAdminPolicy } from "@/auth/oidc-admin";

/** What the signed-in person may do to the identity provider, so the UI can match it. */
export const Route = createFileRoute("/api/idp/access")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const session = await auth.api.getSession({ headers: request.headers });
        if (!session)
          return Response.json({ error: "Unauthorized." }, { status: 401, headers: noStore });
        return Response.json(
          { permissions: await idpPermissions(session.user.id), policy: oidcAdminPolicy() },
          { headers: noStore },
        );
      },
    },
  },
});
