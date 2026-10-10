import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/dev/login")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        // `import.meta.env.DEV` is false in `vp build`, so the import below is dead code
        // there and the dev sign-in never reaches a production bundle.
        if (!import.meta.env.DEV) return new Response("Not found", { status: 404 });
        const { handleDevLogin } = await import("@/dev/login");
        return handleDevLogin(request);
      },
    },
  },
});
