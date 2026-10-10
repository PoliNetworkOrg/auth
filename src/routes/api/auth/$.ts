import { createFileRoute } from "@tanstack/react-router";
import { auth } from "@/auth";
import { redirectLogoutPage } from "@/auth/logout-page";
import { rateLimitedResponse } from "@/auth/rate-limit";

async function handle(request: Request) {
  const response = await auth.handler(request);
  if (response.status === 429 && response.headers.has("x-retry-after"))
    return rateLimitedResponse(request, response);
  return new URL(request.url).pathname.includes("/oauth2/end-session")
    ? redirectLogoutPage(response)
    : response;
}

export const Route = createFileRoute("/api/auth/$")({
  server: {
    handlers: {
      GET: ({ request }) => handle(request),
      POST: ({ request }) => handle(request),
    },
  },
});
