import { createFileRoute } from "@tanstack/react-router";
import { auth } from "@/auth";
import { getIdentity } from "@/auth/identity";

export const Route = createFileRoute("/api/identity")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const session = await auth.api.getSession({ headers: request.headers });
        if (!session)
          return Response.json(
            { error: "Unauthorized" },
            { status: 401, headers: { "Cache-Control": "no-store" } },
          );
        return Response.json(await getIdentity(session.user.id), {
          headers: { "Cache-Control": "no-store" },
        });
      },
    },
  },
});
