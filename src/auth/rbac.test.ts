import { describe, expect, it } from "vite-plus/test";
import {
  type PermissionSummary,
  type RbacCatalog,
  type RoleSummary,
  MANAGED_PERMISSIONS,
  MASTER_ADMIN_ROLE_KEY,
  STATIC_ROLES,
  catalogForIdpPermissions,
  effectiveRolePermissions,
  expandPermissionKeys,
  expandRoleKeys,
  isManagedPermissionKey,
  isStaticRoleKey,
  resolveAccess,
  roleParentWouldCycle,
  staticRolesForStates,
  validatePermissionDraft,
  validateRoleDraft,
} from "./rbac";

function permission(key: string, implies: string[] = [], managed = false): PermissionSummary {
  return {
    id: `p-${key}`,
    key,
    name: key,
    description: null,
    managed,
    implies,
    roleCount: 0,
    createdAt: null,
    updatedAt: null,
  };
}

function role(
  key: string,
  permissions: string[] = [],
  parents: string[] = [],
  managed = false,
): RoleSummary {
  return {
    id: `r-${key}`,
    key,
    name: key,
    description: null,
    managed,
    sourceState: managed ? key : null,
    permissions,
    parents,
    memberCount: 0,
    createdAt: null,
    updatedAt: null,
  };
}

// socio ← direttivo ← chair, with a write permission that covers reading.
const catalog: RbacCatalog = {
  permissions: [
    permission("membership:read"),
    permission("membership:write", ["membership:read"]),
    permission("bank:sign"),
    permission("student:verified"),
  ],
  roles: [
    role("socio", ["membership:read"], [], true),
    role("student", ["student:verified"], [], true),
    role("direttivo", ["membership:write"], ["socio"], true),
    role("chair", ["bank:sign"], ["direttivo"]),
  ],
};

describe("role and permission hierarchies", () => {
  it("follows role inheritance to the top of the chain", () => {
    expect(expandRoleKeys(catalog, ["chair"])).toEqual(["chair", "direttivo", "socio"]);
  });

  it("follows permission grants down the chain", () => {
    expect(expandPermissionKeys(catalog, ["membership:write"])).toEqual([
      "membership:read",
      "membership:write",
    ]);
  });

  it("resolves both hierarchies together", () => {
    expect(resolveAccess(catalog, ["chair"])).toEqual({
      roles: ["chair", "direttivo", "socio"],
      permissions: ["bank:sign", "membership:read", "membership:write"],
    });
  });

  it("grants nothing to someone holding no roles", () => {
    expect(resolveAccess(catalog, [])).toEqual({ roles: [], permissions: [] });
  });

  it("ignores roles and permissions that no longer exist", () => {
    expect(resolveAccess(catalog, ["deleted-role"])).toEqual({ roles: [], permissions: [] });
    expect(expandPermissionKeys(catalog, ["gone"])).toEqual([]);
  });

  it("terminates on stored data that contains a cycle", () => {
    const looping: RbacCatalog = {
      permissions: [permission("a", ["b"]), permission("b", ["a"])],
      roles: [role("x", ["a"], ["y"]), role("y", [], ["x"])],
    };
    expect(resolveAccess(looping, ["x"])).toEqual({ roles: ["x", "y"], permissions: ["a", "b"] });
  });

  it("reports everything a single role confers", () => {
    expect(effectiveRolePermissions(catalog, "direttivo")).toEqual([
      "membership:read",
      "membership:write",
    ]);
  });
});

describe("roles the identity provider defines itself", () => {
  it("derives them from verified states rather than assignments", () => {
    expect(staticRolesForStates(["student", "socio"])).toEqual(["socio", "student"]);
    expect(staticRolesForStates([])).toEqual([]);
    expect(staticRolesForStates(["unrelated"])).toEqual([]);
  });

  it("covers Master Admin, Socio, Direttivo, and Student", () => {
    expect(STATIC_ROLES.map((entry) => entry.key)).toEqual([
      "master-admin",
      "socio",
      "direttivo",
      "student",
    ]);
    for (const key of ["master-admin", "socio", "direttivo", "student"])
      expect(isStaticRoleKey(key)).toBe(true);
    expect(isStaticRoleKey("chair")).toBe(false);
  });

  it("refuses a new role that would shadow one of them", () => {
    const errors = validateRoleDraft(
      { key: "socio", name: "Socio", description: "", parents: [], permissions: [] },
      { catalog: { roles: [], permissions: [] } },
    );
    expect(errors.key).toBeTruthy();
  });
});

describe("validation", () => {
  const context = { catalog };

  it("rejects keys that are empty, malformed, or already used", () => {
    const draft = { name: "Name", description: "", parents: [], permissions: [] };
    expect(validateRoleDraft({ ...draft, key: "" }, context).key).toBeTruthy();
    expect(validateRoleDraft({ ...draft, key: "Has Spaces" }, context).key).toBeTruthy();
    expect(validateRoleDraft({ ...draft, key: "chair" }, context).key).toBeTruthy();
    expect(validateRoleDraft({ ...draft, key: "new-role" }, context).key).toBeUndefined();
  });

  it("keeps a role's own key available while editing it", () => {
    const draft = { key: "chair", name: "Chair", description: "", parents: [], permissions: [] };
    expect(validateRoleDraft(draft, { catalog, currentKey: "chair" }).key).toBeUndefined();
  });

  it("refuses a parent that would make two roles inherit from each other", () => {
    expect(roleParentWouldCycle(catalog, "socio", "chair")).toBe(true);
    expect(roleParentWouldCycle(catalog, "chair", "socio")).toBe(false);
    const errors = validateRoleDraft(
      { key: "socio", name: "Socio", description: "", parents: ["chair"], permissions: [] },
      { catalog, currentKey: "socio" },
    );
    expect(errors.parents).toBeTruthy();
  });

  it("refuses a permission that would grant itself, directly or in a loop", () => {
    expect(
      validatePermissionDraft(
        { key: "bank:sign", name: "Sign", description: "", implies: ["bank:sign"] },
        { catalog, currentKey: "bank:sign" },
      ).implies,
    ).toBeTruthy();
    expect(
      validatePermissionDraft(
        { key: "membership:read", name: "Read", description: "", implies: ["membership:write"] },
        { catalog, currentKey: "membership:read" },
      ).implies,
    ).toBeTruthy();
  });

  it("rejects references to things that were deleted meanwhile", () => {
    expect(
      validateRoleDraft(
        { key: "new-role", name: "New", description: "", parents: [], permissions: ["gone"] },
        context,
      ).permissions,
    ).toBeTruthy();
  });
});

describe("Master Admin", () => {
  const withMaster: RbacCatalog = {
    ...catalog,
    roles: [...catalog.roles, role(MASTER_ADMIN_ROLE_KEY, [], [], true)],
  };

  it("holds every permission without listing any of them", () => {
    const access = resolveAccess(withMaster, [MASTER_ADMIN_ROLE_KEY]);
    expect(access.permissions).toEqual([
      "bank:sign",
      "membership:read",
      "membership:write",
      "student:verified",
    ]);
  });

  it("covers a permission created after it was last edited", () => {
    const later: RbacCatalog = {
      ...withMaster,
      permissions: [...withMaster.permissions, permission("invented:later")],
    };
    expect(resolveAccess(later, [MASTER_ADMIN_ROLE_KEY]).permissions).toContain("invented:later");
  });

  it("cannot be named as a parent, which would make its wildcard assignable", () => {
    const draft = { name: "Deputy", description: "", permissions: [], parents: ["master-admin"] };
    expect(
      validateRoleDraft({ ...draft, key: "deputy" }, { catalog: withMaster }).parents,
    ).toBeTruthy();
    expect(
      validateRoleDraft({ ...draft, key: "chair" }, { catalog: withMaster, currentKey: "chair" })
        .parents,
    ).toBeTruthy();
    // Not even a role the identity provider defines itself: everyone proven a socio would
    // otherwise become omnipotent.
    expect(
      validateRoleDraft({ ...draft, key: "socio" }, { catalog: withMaster, currentKey: "socio" })
        .parents,
    ).toBeTruthy();
  });

  it("still honours an inheriting edge left in the database by an older version", () => {
    const deputy: RbacCatalog = {
      ...withMaster,
      roles: [...withMaster.roles, role("deputy", [], [MASTER_ADMIN_ROLE_KEY])],
    };
    expect(resolveAccess(deputy, ["deputy"]).permissions).toEqual(
      resolveAccess(withMaster, [MASTER_ADMIN_ROLE_KEY]).permissions,
    );
  });

  it("leaves ordinary parents alone", () => {
    expect(
      validateRoleDraft(
        { key: "deputy", name: "Deputy", description: "", permissions: [], parents: ["socio"] },
        { catalog: withMaster },
      ).parents,
    ).toBeUndefined();
  });

  it("is not conferred by any identity state", () => {
    expect(staticRolesForStates(["socio", "student", "direttivo"])).not.toContain(
      MASTER_ADMIN_ROLE_KEY,
    );
  });

  it("gives nothing extra to someone who does not hold it", () => {
    expect(resolveAccess(withMaster, ["socio"]).permissions).toEqual(["membership:read"]);
  });
});

describe("permissions the identity provider defines itself", () => {
  const managedCatalog: RbacCatalog = {
    roles: [role("staff", ["idp:roles:write"])],
    permissions: MANAGED_PERMISSIONS.map((entry) =>
      permission(entry.key, [...entry.implies], true),
    ),
  };

  it("covers roles, permissions, applications, and people", () => {
    expect(MANAGED_PERMISSIONS.map((entry) => entry.key)).toEqual([
      "idp:people:read",
      "idp:permissions:read",
      "idp:permissions:write",
      "idp:roles:read",
      "idp:roles:write",
      "idp:applications:read",
      "idp:applications:write",
    ]);
    for (const entry of MANAGED_PERMISSIONS) expect(isManagedPermissionKey(entry.key)).toBe(true);
    expect(isManagedPermissionKey("membership:read")).toBe(false);
  });

  it("expands managing roles into reading roles, permissions, and people", () => {
    expect(resolveAccess(managedCatalog, ["staff"]).permissions).toEqual([
      "idp:people:read",
      "idp:permissions:read",
      "idp:roles:read",
      "idp:roles:write",
    ]);
  });

  it("does not let managing roles reach applications", () => {
    expect(resolveAccess(managedCatalog, ["staff"]).permissions).not.toContain(
      "idp:applications:write",
    );
  });

  it("refuses a new permission that would shadow one of them", () => {
    expect(
      validatePermissionDraft(
        { key: "idp:roles:write", name: "Mine", description: "", implies: [] },
        { catalog: { roles: [], permissions: [] } },
      ).key,
    ).toBeTruthy();
  });

  it("refuses to rekey one of them", () => {
    expect(
      validatePermissionDraft(
        { key: "idp:roles:writeable", name: "Manage roles", description: "", implies: [] },
        { catalog: managedCatalog, currentKey: "idp:roles:write" },
      ).key,
    ).toBeTruthy();
  });
});

describe("administration catalog visibility", () => {
  it("does not disclose roles to someone who may only read permissions", () => {
    const visible = catalogForIdpPermissions(catalog, ["idp:permissions:read"]);
    expect(visible.permissions).toBe(catalog.permissions);
    expect(visible.roles).toEqual([]);
  });

  it("keeps the permission graph available when explaining roles", () => {
    const visible = catalogForIdpPermissions(catalog, ["idp:roles:read"]);
    expect(visible).toEqual(catalog);
  });
});
