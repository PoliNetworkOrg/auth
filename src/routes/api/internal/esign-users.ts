import { createFileRoute } from "@tanstack/react-router";
import { asc, eq, isNull } from "drizzle-orm";
import { snapshotClientId } from "@/auth/access-snapshot-token";
import { contactEmails } from "@/auth/contact-email";
import { projectionForClient } from "@/auth/access-projections";
import { db } from "@/db";
import { user, peopleRegistration } from "@/db/schema";
import { env } from "@/env";

const headers = { "Cache-Control": "private, no-store", Vary: "Authorization" };

/**
 * Registered identities for the backend's e-signing picker; access is checked by the backend's live snapshot.
 * The email is the one administrators see (PoliNetwork first), never a sign-in placeholder.
 */
export const Route = createFileRoute("/api/internal/esign-users")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!env.OAUTH_BACKEND_CLIENT_ID || !env.OAUTH_INTERNAL_RESOURCE_URI)
          return Response.json({ error: "Unavailable" }, { status: 503, headers });
        const clientId = await snapshotClientId(request.headers.get("authorization"));
        if (!clientId) return Response.json({ error: "Unauthorized" }, { status: 401, headers });
        if (projectionForClient(clientId) !== "backend")
          return Response.json({ error: "Forbidden" }, { status: 403, headers });
        const people = await db
          .select({ id: user.id, name: user.name, email: user.email })
          .from(user)
          .leftJoin(peopleRegistration, eq(peopleRegistration.id, user.id))
          .where(isNull(peopleRegistration.id))
          .orderBy(asc(user.name), asc(user.id));
        const emails = await contactEmails(db, people, "everyone");
        return Response.json(
          people.map((person) => ({
            sub: person.id,
            name: person.name,
            email: emails.get(person.id) ?? null,
          })),
          { headers },
        );
      },
    },
  },
});
