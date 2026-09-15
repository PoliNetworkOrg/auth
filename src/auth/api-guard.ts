import { auth } from "./index";
import { canAdministerIdp } from "./oidc-admin";
import { env } from "../env";

export const noStore = { "Cache-Control": "no-store" };

export function apiError(status: number, error: string, fields?: Record<string, string>) {
  return Response.json(fields ? { error, fields } : { error }, { status, headers: noStore });
}

type Guard = { session: { userId: string } } | { response: Response };

/**
 * Shared entry check for the administration endpoints: a same-origin request when it
 * changes something, a signed-in session, and identity-provider administrator access.
 */
export async function requireAdministrator(
  request: Request,
  options: { write?: boolean } = {},
): Promise<Guard> {
  if (options.write && request.headers.get("origin") !== new URL(env.BETTER_AUTH_URL).origin)
    return { response: Response.json({ error: "Invalid origin." }, { status: 403 }) };
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return { response: apiError(401, "Unauthorized.") };
  if (!(await canAdministerIdp(session.user.id)))
    return { response: apiError(403, "You cannot manage roles and permissions.") };
  return { session: { userId: session.user.id } };
}
