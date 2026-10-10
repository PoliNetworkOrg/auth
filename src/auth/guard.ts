import { isNotFound, isRedirect } from "@tanstack/react-router";
import { ActionError } from "@/lib/action-error";
import { AccountError } from "./accounts";
import { logAuthorizationDenial } from "./denial-log";
import { auth } from "./index";
import { idpPermissions } from "./idp-access";
import type { ManagedPermissionKey } from "./rbac";
import { RbacError } from "./rbac-store";
import { StudentVerificationError } from "./student-verification";

export type Principal = { userId: string; permissions: string[] };

/** The signed-in person, from the session cookie on the request. */
export async function requireSession(headers: Headers): Promise<{ userId: string }> {
  const session = await auth.api.getSession({ headers });
  if (!session?.user?.id) throw new ActionError(401, "Sign in to continue.");
  return { userId: session.user.id };
}

/**
 * The entry check for every administration server function: a signed-in session that holds
 * at least one of the managed permissions the function needs. Same-origin is enforced for
 * every server function by the CSRF middleware in `src/start.ts`.
 *
 * `endpoint` names what was refused in the denial log.
 */
export async function authorize(
  headers: Headers,
  required: readonly ManagedPermissionKey[],
  endpoint: string,
): Promise<Principal> {
  const deny = (status: number, message: string, actorId: string | null = null) => {
    logAuthorizationDenial(actorId, endpoint, required);
    return new ActionError(status, message, undefined, required[0]);
  };
  const session = await auth.api.getSession({ headers });
  if (!session?.user?.id) throw deny(401, "Sign in to continue.");
  let permissions: string[];
  try {
    permissions = await idpPermissions(session.user.id);
  } catch {
    throw deny(503, "Authorization unavailable.", session.user.id);
  }
  if (!required.some((permission) => permissions.includes(permission)))
    throw deny(403, "You do not have permission to do that.", session.user.id);
  return { userId: session.user.id, permissions };
}

/**
 * What a server function may tell the browser about a failure. Refusals the domain code
 * explains are passed on with their status; anything unexpected is logged here and reported
 * without its message, which may describe the database or another internal system.
 */
export function toActionError(cause: unknown): unknown {
  if (cause instanceof ActionError || isRedirect(cause) || isNotFound(cause)) return cause;
  if (cause instanceof RbacError) return new ActionError(cause.status, cause.message, cause.fields);
  if (cause instanceof AccountError || cause instanceof StudentVerificationError)
    return new ActionError(cause.status, cause.message);
  console.error(cause);
  return new ActionError(500, "Something went wrong. Try again.");
}
