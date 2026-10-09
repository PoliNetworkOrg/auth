import { createHash } from "node:crypto";
import { createFileRoute } from "@tanstack/react-router";
import { buildBackendSnapshot } from "@/auth/access-snapshot";
import { snapshotClientId } from "@/auth/access-snapshot-token";
import { projectionForClient } from "@/auth/access-projections";
import { env } from "@/env";

const headers = { "Cache-Control": "private, no-store" };

export const Route = createFileRoute("/api/internal/access-snapshot")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!env.OAUTH_BACKEND_CLIENT_ID || !env.OAUTH_INTERNAL_RESOURCE_URI)
          return Response.json({ error: "Unavailable" }, { status: 503, headers });
        const clientId = await snapshotClientId(request.headers.get("authorization"));
        if (!clientId) return Response.json({ error: "Unauthorized" }, { status: 401, headers });
        if (projectionForClient(clientId) !== "backend")
          return Response.json({ error: "Forbidden" }, { status: 403, headers });
        try {
          const body = await buildBackendSnapshot();
          const etag = `"sha256-${createHash("sha256").update(body).digest("hex")}"`;
          const responseHeaders = { ...headers, ETag: etag };
          if (
            request.headers
              .get("if-none-match")
              ?.split(",")
              .some((entry) => entry.trim() === etag || entry.trim() === "*")
          )
            return new Response(null, { status: 304, headers: responseHeaders });
          return new Response(body, {
            headers: { ...responseHeaders, "Content-Type": "application/json; charset=utf-8" },
          });
        } catch {
          return Response.json({ error: "Snapshot unavailable" }, { status: 503, headers });
        }
      },
    },
  },
});
