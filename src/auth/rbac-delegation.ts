import {
  type RbacCatalog,
  type ResolvedAccess,
  MASTER_ADMIN_ROLE_KEY,
  effectiveRolePermissions,
  expandPermissionKeys,
  inheritedBuiltInRoles,
  resolveAccess,
} from "./rbac";

/**
 * The built-in roles that some role, matched by id, gives through inheritance in one graph
 * but not in the other, sorted. A role missing from a graph gives none there, so a new role
 * that inherits a built-in role counts, and so does deleting one.
 */
export function inheritedBuiltInRoleChanges(before: RbacCatalog, after: RbacCatalog): string[] {
  const reached = (catalog: RbacCatalog, id: string) => {
    const found = catalog.roles.find((entry) => entry.id === id);
    return new Set(found ? inheritedBuiltInRoles(catalog, found.key) : []);
  };
  const changed = new Set<string>();
  for (const id of new Set([...before.roles, ...after.roles].map((entry) => entry.id))) {
    const was = reached(before, id);
    const is = reached(after, id);
    for (const key of was) if (!is.has(key)) changed.add(key);
    for (const key of is) if (!was.has(key)) changed.add(key);
  }
  return [...changed].sort();
}

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
    // Giving or taking back a role that inherits a built-in role gives or takes back the
    // built-in role too, which only a Master Admin does.
    if (
      (operation === "role.assign" || operation === "role.unassign") &&
      old &&
      inheritedBuiltInRoles(before, old.key).length
    )
      return false;
    // Binding such a role to People, or to another concept there, lets People writers give
    // and take back the built-in role. Unbinding takes that away, so anyone may do it.
    if (
      operation === "role.people" &&
      next?.peopleBinding &&
      next.peopleBinding !== old?.peopleBinding &&
      inheritedBuiltInRoles(after, next.key).length
    )
      return false;
  }
  if (!subset(resolveAccess(after, access.roles).permissions)) return false;
  // Only a Master Admin confers a built-in role, so nobody else may change which built-in
  // roles any role inherits, directly or through another role.
  if (inheritedBuiltInRoleChanges(before, after).length) return false;
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
