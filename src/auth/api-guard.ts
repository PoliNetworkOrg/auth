import { auth } from "./index";
import { idpPermissions } from "./idp-access";
import type { ManagedPermissionKey } from "./rbac";
import { env } from "../env";

export const noStore = { "Cache-Control": "no-store" };

export function apiError(status: number, error: string, fields?: Record<string, string>) {
  return Response.json(fields ? { error, fields } : { error }, { status, headers: noStore });
}

type Guard = { session: { userId: string; permissions: string[] } } | { response: Response };

async function requirePermission(
  request: Request,
  required: readonly ManagedPermissionKey[],
  options: { write?: boolean },
): Promise<Guard> {
  if (options.write && request.headers.get("origin") !== new URL(env.BETTER_AUTH_URL).origin)
    return { response: apiError(403, "Invalid origin.") };
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return { response: apiError(401, "Unauthorized.") };
  const permissions = await idpPermissions(session.user.id);
  if (!required.some((permission) => permissions.includes(permission)))
    return { response: apiError(403, "You do not have permission to do that.") };
  return { session: { userId: session.user.id, permissions } };
}

/**
 * Shared entry check for the administration endpoints: a same-origin request when it
 * changes something, a signed-in session, and the managed permission the endpoint needs.
 */
export async function requireIdpPermission(
  request: Request,
  permission: ManagedPermissionKey,
  options: { write?: boolean } = {},
): Promise<Guard> {
  return requirePermission(request, [permission], options);
}

export async function requireAnyIdpPermission(
  request: Request,
  permissions: readonly ManagedPermissionKey[],
  options: { write?: boolean } = {},
): Promise<Guard> {
  return requirePermission(request, permissions, options);
}
