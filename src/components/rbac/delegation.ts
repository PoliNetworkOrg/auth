import {
  effectiveRolePermissions,
  expandPermissionKeys,
  inheritedBuiltInRoles,
  type RbacCatalog,
  type RoleSummary,
  takesHandAssignments,
} from "@/auth/rbac";

type DelegationAccess = { isMasterAdmin: boolean; permissions: readonly string[] };

/** UI hints only. The server checks the complete proposed graph with current authority. */
export function canGrantPermission(access: DelegationAccess, catalog: RbacCatalog, key: string) {
  return (
    access.isMasterAdmin ||
    expandPermissionKeys(catalog, [key]).every((permission) =>
      access.permissions.includes(permission),
    )
  );
}

export function canGrantRole(access: DelegationAccess, catalog: RbacCatalog, key: string) {
  return (
    access.isMasterAdmin ||
    effectiveRolePermissions(catalog, key).every((permission) =>
      access.permissions.includes(permission),
    )
  );
}

/** Whether holding this role means holding a built-in role, which only Master Admin confers. */
export function confersBuiltInRole(catalog: RbacCatalog, role: RoleSummary) {
  return role.managed || inheritedBuiltInRoles(catalog, role.key).length > 0;
}

/** Whether a role may be picked, or dropped, as a parent of another role. */
export function canInheritFrom(access: DelegationAccess, catalog: RbacCatalog, role: RoleSummary) {
  return (
    access.isMasterAdmin ||
    (!confersBuiltInRole(catalog, role) && canGrantRole(access, catalog, role.key))
  );
}

/**
 * Built-in roles that take assignments, and roles inheriting any built-in role, are given and
 * taken back by Master Admin only.
 */
export function canAssignRole(access: DelegationAccess, catalog: RbacCatalog, role: RoleSummary) {
  return (
    takesHandAssignments(role) &&
    (access.isMasterAdmin ||
      (!confersBuiltInRole(catalog, role) && canGrantRole(access, catalog, role.key)))
  );
}
