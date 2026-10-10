import { createFileRoute } from "@tanstack/react-router";
import { auth } from "@/auth";
import { redirectLogoutPage } from "@/auth/logout-page";

async function handle(request: Request) {
  const response = await auth.handler(request);
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
