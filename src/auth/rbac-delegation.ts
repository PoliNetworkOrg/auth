import {
  type RbacCatalog,
  type ResolvedAccess,
  MASTER_ADMIN_ROLE_KEY,
  effectiveRolePermissions,
  expandPermissionKeys,
  resolveAccess,
} from "./rbac";

/** Compare both committed and proposed graphs. Called under the mutation lock; a false
 * result rolls back the entire transaction, including edge replacements and assignments. */
export function mayDelegateMutation(
  before: RbacCatalog,
  after: RbacCatalog,
  access: ResolvedAccess,
  operation: string,
  targetId: string,
): boolean {
  if (access.roles.includes(MASTER_ADMIN_ROLE_KEY)) return true;
  const held = new Set(access.permissions);
  const subset = (permissions: readonly string[]) => permissions.every((key) => held.has(key));
  const same = (a: readonly string[], b: readonly string[]) =>
    a.length === b.length && a.every((key, index) => key === b[index]);
  if (operation.startsWith("permission.")) {
    const old = before.permissions.find((entry) => entry.id === targetId);
    const next = after.permissions.find((entry) => entry.id === targetId);
    if (old?.managed || next?.managed) return false;
    if (old && !subset(expandPermissionKeys(before, [old.key]))) return false;
    // Defining a new capability does not confer it. Activating it requires a grant by
    // someone who already holds it (initially Master Admin).
    if (
      next &&
      !subset(expandPermissionKeys(after, [next.key]).filter((key) => old || key !== next.key))
    )
      return false;
  } else {
    const old = before.roles.find((entry) => entry.id === targetId);
    const next = after.roles.find((entry) => entry.id === targetId);
    if (old?.managed || next?.managed) return false;
    if (old && !subset(effectiveRolePermissions(before, old.key))) return false;
    if (next && !subset(effectiveRolePermissions(after, next.key))) return false;
  }
  if (!subset(resolveAccess(after, access.roles).permissions)) return false;
  // Custom ancestors/implications cannot act as a backdoor for editing managed or
  // more privileged roles, including roles the writer does not themselves hold.
  for (const old of before.roles) {
    // Catalog growth always extends the deployment-conferred wildcard; it does not
    // confer new authority on the writer or alter Master Admin membership.
    if (old.key === MASTER_ADMIN_ROLE_KEY) continue;
    const next = after.roles.find((entry) => entry.id === old.id);
    const previous = effectiveRolePermissions(before, old.key);
    const proposed = next ? effectiveRolePermissions(after, next.key) : [];
    if (!same(previous, proposed) && (old.managed || !subset(previous) || !subset(proposed)))
      return false;
  }
  for (const old of before.permissions.filter((entry) => entry.managed)) {
    const next = after.permissions.find((entry) => entry.id === old.id);
    if (
      !next ||
      !same(expandPermissionKeys(before, [old.key]), expandPermissionKeys(after, [next.key]))
    )
      return false;
  }
  return true;
}
