import { MANAGED_PERMISSION_KEYS, type ManagedPermissionKey } from "./rbac";
import { getIdentity } from "./identity";

/**
 * What a person may do to this identity provider itself, as the managed `idp:*`
 * permissions they hold.
 *
 * These come out of the same resolution as every other permission, so they can be given to
 * any role. Whoever the deployment configures as an administrator holds Master Admin, which
 * is a wildcard over every permission, so the configured allowlist keeps working as the
 * bootstrap and break-glass path without being a second kind of check.
 */
export async function idpPermissions(userId: string): Promise<string[]> {
  const identity = await getIdentity(userId);
  return identity.permissions.filter((key) => MANAGED_PERMISSION_KEYS.includes(key));
}

export async function hasIdpPermission(
  userId: string,
  required: ManagedPermissionKey,
): Promise<boolean> {
  return (await idpPermissions(userId)).includes(required);
}
