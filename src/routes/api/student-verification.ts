import { createFileRoute } from "@tanstack/react-router";
import { auth } from "@/auth";
import {
  confirmStudentVerification,
  requestStudentVerification,
  StudentVerificationError,
} from "@/auth/student-verification";
import { env } from "@/env";

export const Route = createFileRoute("/api/student-verification")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (request.headers.get("origin") !== new URL(env.BETTER_AUTH_URL).origin) {
          return Response.json({ error: "Invalid origin." }, { status: 403 });
        }
        const session = await auth.api.getSession({ headers: request.headers });
        if (!session) return Response.json({ error: "Unauthorized." }, { status: 401 });
        try {
          const body: unknown = await request.json();
          if (!body || typeof body !== "object" || !("action" in body)) {
            throw new StudentVerificationError(400, "Invalid request.");
          }
          if (body.action === "request") {
            const email = "email" in body ? body.email : undefined;
            return Response.json(await requestStudentVerification(session.user.id, email), {
              headers: { "Cache-Control": "no-store" },
            });
          }
          if (body.action === "confirm") {
            const email = "email" in body ? body.email : undefined;
            const code = "code" in body ? body.code : undefined;
            return Response.json(
              await confirmStudentVerification(session.user.id, { email, code }),
              { headers: { "Cache-Control": "no-store" } },
            );
          }
          throw new StudentVerificationError(400, "Invalid request.");
        } catch (error) {
          if (error instanceof StudentVerificationError) {
            return Response.json(
              { error: error.message },
              { status: error.status, headers: { "Cache-Control": "no-store" } },
            );
          }
          return Response.json(
            { error: "Student verification failed." },
            { status: 500, headers: { "Cache-Control": "no-store" } },
          );
        }
      },
    },
  },
});
