import { createFileRoute } from "@tanstack/react-router";
import { studentVerificationEmailConfigured } from "@/auth/email";
import { providers } from "@/auth/providers";
import { env } from "@/env";

export const Route = createFileRoute("/api/providers")({
  server: {
    handlers: {
      GET: () =>
        Response.json({
          signIn: [
            ...(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET ? ["google"] : []),
            ...(providers.some((provider) => provider.providerId === "pn-entra")
              ? ["pn-entra"]
              : []),
          ],
          link: [
            ...(providers.some((provider) => provider.providerId === "telegram")
              ? ["telegram"]
              : []),
            ...(studentVerificationEmailConfigured ? ["polimi-email"] : []),
          ],
        }),
    },
  },
});
