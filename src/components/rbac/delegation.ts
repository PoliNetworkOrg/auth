import {
  effectiveRolePermissions,
  expandPermissionKeys,
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

/** Built-in roles that take assignments are given and taken back by Master Admin only. */
export function canAssignRole(access: DelegationAccess, catalog: RbacCatalog, role: RoleSummary) {
  return (
    takesHandAssignments(role) &&
    (access.isMasterAdmin || (!role.managed && canGrantRole(access, catalog, role.key)))
  );
}
