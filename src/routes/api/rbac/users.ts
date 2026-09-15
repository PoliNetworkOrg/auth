import { createFileRoute } from "@tanstack/react-router";
import { noStore, requireAdministrator } from "@/auth/api-guard";
import { searchUsers } from "@/auth/rbac-store";

export const Route = createFileRoute("/api/rbac/users")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const guard = await requireAdministrator(request);
        if ("response" in guard) return guard.response;
        const query = new URL(request.url).searchParams.get("q") ?? "";
        return Response.json(await searchUsers(query), { headers: noStore });
      },
    },
  },
});
