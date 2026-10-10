import { useRouteContext } from "@tanstack/react-router";
import { createIsomorphicFn } from "@tanstack/react-start";
import { setResponseStatus } from "@tanstack/react-start/server";
import { MASTER_ADMIN_ROLE_KEY, type ManagedPermissionKey } from "@/auth/rbac";
import type { ProviderCapabilities, Viewer } from "@/auth/session.functions";
import { ActionError } from "@/lib/action-error";

export type Access = {
  permissions: readonly string[];
  roles: readonly string[];
  isMasterAdmin: boolean;
  /** Whether the signed-in person holds a managed permission. */
  can: (permission: ManagedPermissionKey) => boolean;
};

export function accessOf(viewer: Viewer | null): Access {
  const permissions = viewer?.permissions ?? [];
  const roles = viewer?.roles ?? [];
  return {
    permissions,
    roles,
    isMasterAdmin: roles.includes(MASTER_ADMIN_ROLE_KEY),
    can: (permission) => permissions.includes(permission),
  };
}

/** The signed-in person, or null, as the root route loaded them. */
export function useViewer(): Viewer | null {
  return useRouteContext({ from: "__root__", select: (context) => context.viewer });
}

/** What the signed-in person may do to the identity provider, as the server decided it. */
export function useAccess(): Access {
  return accessOf(useViewer());
}

/**
 * Gives a server-rendered refusal its real status. Any error thrown while loading a route
 * is otherwise answered with 500, and these pages are expected outcomes, not failures.
 */
const setRefusalStatus = createIsomorphicFn().server((status: number) => setResponseStatus(status));

/** For `beforeLoad`: shows the sign-in page in place of a page that needs a session. */
export function requireViewer(viewer: Viewer | null): Viewer {
  if (!viewer) {
    setRefusalStatus(401);
    throw new ActionError(401, "Sign in to continue.");
  }
  return viewer;
}

/**
 * For `beforeLoad`: refuses a page unless the person holds one of `permissions`, before its
 * loader asks the server for data it would refuse anyway. The server functions enforce the
 * same permissions; this only keeps the page honest.
 */
export function requireAccess(viewer: Viewer | null, ...permissions: ManagedPermissionKey[]) {
  const access = accessOf(requireViewer(viewer));
  if (!permissions.some(access.can)) {
    setRefusalStatus(403);
    throw new ActionError(403, "You don't have access to this page.", undefined, permissions[0]);
  }
}

/** Which accounts this deployment can sign in with, and which it can link afterwards. */
export function useProviders(): ProviderCapabilities {
  return useRouteContext({ from: "__root__", select: (context) => context.providers });
}
