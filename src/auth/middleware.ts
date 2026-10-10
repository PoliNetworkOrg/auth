import { createMiddleware } from "@tanstack/react-start";
import { getRequest, setResponseHeader, setResponseStatus } from "@tanstack/react-start/server";
import { ActionError } from "@/lib/action-error";
import { authorize, requireSession, toActionError } from "./guard";
import type { ManagedPermissionKey } from "./rbac";

/**
 * Keeps every response out of shared caches, and turns failures into errors the page can
 * show. Every other middleware here builds on it.
 */
export const actionMiddleware = createMiddleware({ type: "function" }).server(async ({ next }) => {
  setResponseHeader("Cache-Control", "no-store");
  try {
    return await next();
  } catch (cause) {
    const error = toActionError(cause);
    // When a loader calls this while rendering a page, the page answers with the refusal's
    // status (a 404 for a missing record, say) rather than the router's 500.
    if (error instanceof ActionError) setResponseStatus(error.status);
    throw error;
  }
});

/** For server functions about the signed-in person's own account. */
export const sessionMiddleware = createMiddleware({ type: "function" })
  .middleware([actionMiddleware])
  .server(async ({ next }) => {
    const session = await requireSession(getRequest().headers);
    return next({ context: { session } });
  });

/**
 * For administration server functions: the session must hold at least one of `permissions`.
 * Route guards only shape the page; this is what protects the data.
 */
export function permissionMiddleware(...permissions: ManagedPermissionKey[]) {
  return createMiddleware({ type: "function" })
    .middleware([actionMiddleware])
    .server(async ({ next, serverFnMeta }) => {
      const session = await authorize(getRequest().headers, permissions, serverFnMeta.name);
      return next({ context: { session } });
    });
}
