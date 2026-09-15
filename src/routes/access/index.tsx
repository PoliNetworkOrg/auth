import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/access/")({
  beforeLoad: () => {
    throw redirect({ to: "/access/roles" });
  },
});
