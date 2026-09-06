import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { auth } from "@/auth";
import { AccountError, disconnectAccount } from "@/auth/accounts";
import { env } from "@/env";

const inputSchema = z.object({ accountId: z.string().min(1) });

export const Route = createFileRoute("/api/accounts/unlink")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (request.headers.get("origin") !== new URL(env.BETTER_AUTH_URL).origin) {
          return Response.json({ error: "Invalid origin." }, { status: 403 });
        }
        const session = await auth.api.getSession({ headers: request.headers });
        if (!session) return Response.json({ error: "Unauthorized." }, { status: 401 });
        try {
          const input = inputSchema.parse(await request.json());
          await disconnectAccount(session.user.id, input.accountId);
          return Response.json({ success: true }, { headers: { "Cache-Control": "no-store" } });
        } catch (error) {
          if (error instanceof AccountError) {
            return Response.json(
              { error: error.message },
              { status: error.status, headers: { "Cache-Control": "no-store" } },
            );
          }
          if (error instanceof z.ZodError) {
            return Response.json({ error: "Invalid request." }, { status: 400 });
          }
          return Response.json({ error: "Unable to disconnect account." }, { status: 500 });
        }
      },
    },
  },
});
