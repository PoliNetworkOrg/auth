import { effectiveRolePermissions, expandPermissionKeys, type RbacCatalog } from "@/auth/rbac";

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
