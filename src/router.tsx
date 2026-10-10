import { createRouter as createTanStackRouter } from "@tanstack/react-router";
import { NotFoundPage, PendingPage, RouteError } from "./components/route-error";
import { routeTree } from "./routeTree.gen";

export function getRouter() {
  const router = createTanStackRouter({
    routeTree,
    scrollRestoration: true,
    defaultPreload: "intent",
    defaultErrorComponent: RouteError,
    defaultPendingComponent: PendingPage,
    defaultNotFoundComponent: NotFoundPage,
  });

  return router;
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
