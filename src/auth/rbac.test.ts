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
  inheritedBuiltInRoles,
  isManagedPermissionKey,
  isStaticRoleKey,
  resolveAccess,
  roleParentWouldCycle,
  staticRolesForStates,
  takesHandAssignments,
  validatePermissionDraft,
  validateRoleDraft,
  withIntrinsicImplications,
} from "./rbac";
import { inheritedBuiltInRoleChanges, mayDelegateMutation } from "./rbac-delegation";

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
    peopleBinding: null,
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

  it("covers Master Admin, Socio, Direttivo, the board offices, and Student", () => {
    const keys = ["master-admin", "socio", "direttivo", "presidente", "segretario", "student"];
    expect(STATIC_ROLES.map((entry) => entry.key)).toEqual(keys);
    for (const key of keys) expect(isStaticRoleKey(key)).toBe(true);
    expect(isStaticRoleKey("chair")).toBe(false);
  });

  it("never confers the board offices from a state", () => {
    expect(staticRolesForStates(["presidente", "segretario", "direttivo"])).toEqual(["direttivo"]);
  });

  it("takes hand assignments only for created roles and the board offices", () => {
    for (const key of ["presidente", "segretario"])
      expect(takesHandAssignments({ key, managed: true })).toBe(true);
    for (const key of ["master-admin", "socio", "direttivo", "student"])
      expect(takesHandAssignments({ key, managed: true })).toBe(false);
    expect(takesHandAssignments({ key: "chair", managed: false })).toBe(true);
  });

  it("refuses a new role that would shadow one of them", () => {
    const errors = validateRoleDraft(
      { key: "socio", name: "Socio", description: "", parents: [], permissions: [] },
      { catalog: { roles: [], permissions: [] } },
    );
    expect(errors.key).toBeTruthy();
  });
});

describe("board offices", () => {
  const offices: RbacCatalog = {
    permissions: catalog.permissions,
    roles: [
      ...catalog.roles,
      role("presidente", [], ["direttivo"], true),
      role("segretario", [], ["direttivo"], true),
    ],
  };

  it("give their holders everything Direttivo confers", () => {
    for (const key of ["presidente", "segretario"])
      expect(resolveAccess(offices, [key])).toEqual({
        roles: [key, "direttivo", "socio"].sort(),
        permissions: ["membership:read", "membership:write"],
      });
  });

  it("refuse an edit that drops Direttivo as a parent", () => {
    const draft = { key: "presidente", name: "Presidente", description: "", permissions: [] };
    const context = { catalog: offices, currentKey: "presidente" };
    expect(validateRoleDraft({ ...draft, parents: [] }, context).parents).toMatch(/direttivo/);
    expect(
      validateRoleDraft({ ...draft, parents: ["direttivo"] }, context).parents,
    ).toBeUndefined();
    expect(
      validateRoleDraft({ ...draft, parents: ["direttivo", "student"] }, context).parents,
    ).toBeUndefined();
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

  it("denies a wildcard inherited through an edge left by an older version", () => {
    const deputy: RbacCatalog = {
      ...withMaster,
      roles: [...withMaster.roles, role("deputy", [], [MASTER_ADMIN_ROLE_KEY])],
    };
    expect(resolveAccess(deputy, ["deputy"]).permissions).toEqual([]);
    expect(resolveAccess(deputy, ["deputy"]).roles).not.toContain(MASTER_ADMIN_ROLE_KEY);
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

  it("covers roles, permissions, applications, people, and the MCP server", () => {
    expect(MANAGED_PERMISSIONS.map((entry) => entry.key)).toEqual([
      "idp:people:read",
      "idp:users:read",
      "idp:users:delete",
      "idp:permissions:read",
      "idp:permissions:write",
      "idp:roles:read",
      "idp:roles:write",
      "idp:roles:assign",
      "idp:people:bind",
      "idp:applications:read",
      "idp:applications:write",
      "idp:mcp",
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

  it("keeps editing and assigning roles independent of each other", () => {
    const split: RbacCatalog = {
      ...managedCatalog,
      roles: [role("editor", ["idp:roles:write"]), role("assigner", ["idp:roles:assign"])],
    };
    expect(resolveAccess(split, ["editor"]).permissions).not.toContain("idp:roles:assign");
    expect(resolveAccess(split, ["assigner"]).permissions).toEqual([
      "idp:people:read",
      "idp:permissions:read",
      "idp:roles:assign",
      "idp:roles:read",
    ]);
  });

  it("lets browsing users find people but not see or change roles", () => {
    const browsing: RbacCatalog = {
      ...managedCatalog,
      roles: [role("support", ["idp:users:read"])],
    };
    expect(resolveAccess(browsing, ["support"]).permissions).toEqual([
      "idp:people:read",
      "idp:users:read",
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

  it("always lets managing roles or permissions see them, whatever is stored", () => {
    const stripped: RbacCatalog = {
      roles: [role("roles", ["idp:roles:write"]), role("permissions", ["idp:permissions:write"])],
      permissions: MANAGED_PERMISSIONS.map((entry) =>
        permission(entry.key, withIntrinsicImplications(entry.key, []), true),
      ),
    };
    expect(resolveAccess(stripped, ["roles"]).permissions).toContain("idp:roles:read");
    expect(resolveAccess(stripped, ["permissions"]).permissions).toContain("idp:permissions:read");
    expect(withIntrinsicImplications("idp:users:delete", [])).toEqual(["idp:users:read"]);
    expect(withIntrinsicImplications("idp:applications:write", [])).toEqual([]);
    expect(withIntrinsicImplications("constructor", [])).toEqual([]);
  });

  it("refuses to drop the read a write permission always grants", () => {
    for (const [key, read] of [
      ["idp:roles:write", "idp:roles:read"],
      ["idp:roles:assign", "idp:roles:read"],
      ["idp:permissions:write", "idp:permissions:read"],
      ["idp:users:delete", "idp:users:read"],
    ]) {
      const implies = managedCatalog.permissions.find((entry) => entry.key === key)!.implies;
      const draft = { key, name: key, description: "", implies };
      const context = { catalog: managedCatalog, currentKey: key };
      expect(validatePermissionDraft(draft, context).implies).toBeUndefined();
      expect(
        validatePermissionDraft(
          { ...draft, implies: implies.filter((implied) => implied !== read) },
          context,
        ).implies,
      ).toBeTruthy();
    }
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

describe("built-in roles given through inheritance", () => {
  const ROLE_ADMIN = ["idp:roles:write", "idp:roles:assign", "idp:roles:read", "idp:people:read"];
  // The six built-in roles as production has them, with a delegated role administrator.
  const base: RbacCatalog = {
    permissions: [
      ...MANAGED_PERMISSIONS.map((entry) => permission(entry.key, [...entry.implies], true)),
      permission("board:read"),
      permission("team:read"),
    ],
    roles: [
      ...STATIC_ROLES.map((entry) =>
        role(
          entry.key,
          entry.key === "direttivo" ? ["board:read"] : [],
          entry.key === "direttivo" ? ["socio"] : [...entry.parents],
          true,
        ),
      ),
      role("role-admin", ROLE_ADMIN),
      role("team", ["team:read"]),
      role("team-lead", [], ["team"]),
    ],
  };
  const actor = resolveAccess(base, ["direttivo", "role-admin", "team"]);
  const master = resolveAccess(base, [MASTER_ADMIN_ROLE_KEY]);
  const withRole = (catalog: RbacCatalog, entry: RoleSummary): RbacCatalog => ({
    ...catalog,
    roles: [...catalog.roles.filter((other) => other.id !== entry.id), entry],
  });
  const helper = role("helper", [], ["presidente"]);
  const withHelper = withRole(base, helper);

  it("lists the built-in roles a role gives, without the role itself", () => {
    expect(inheritedBuiltInRoles(withHelper, "helper")).toEqual([
      "direttivo",
      "presidente",
      "socio",
    ]);
    expect(inheritedBuiltInRoles(base, "presidente")).toEqual(["direttivo", "socio"]);
    expect(inheritedBuiltInRoles(base, "socio")).toEqual([]);
    expect(inheritedBuiltInRoles(base, "team-lead")).toEqual([]);
  });

  it("refuses a delegated writer who creates a role inheriting Presidente, then assigns it", () => {
    const draft = { key: "helper", name: "helper", description: "", parents: ["presidente"] };
    // The draft itself is valid: the refusal comes from who is making the change.
    expect(validateRoleDraft({ ...draft, permissions: [] }, { catalog: base })).toEqual({});
    expect(resolveAccess(withHelper, ["helper"]).roles).toEqual([
      "direttivo",
      "helper",
      "presidente",
      "socio",
    ]);
    expect(mayDelegateMutation(base, withHelper, actor, "role.save", helper.id)).toBe(false);
    expect(mayDelegateMutation(withHelper, withHelper, actor, "role.assign", helper.id)).toBe(
      false,
    );
    expect(mayDelegateMutation(withHelper, withHelper, actor, "role.unassign", helper.id)).toBe(
      false,
    );
  });

  it("refuses inheriting any built-in role, by a new role or an existing one", () => {
    for (const parent of ["socio", "direttivo", "presidente", "segretario", "student"]) {
      const created = withRole(base, role("helper", [], [parent]));
      expect(mayDelegateMutation(base, created, actor, "role.save", "r-helper")).toBe(false);
      const edited = withRole(base, role("team", ["team:read"], [parent]));
      expect(mayDelegateMutation(base, edited, actor, "role.save", "r-team")).toBe(false);
    }
  });

  it("refuses giving a built-in role through another role", () => {
    // A Master Admin made `helper`; inheriting it gives Presidente just the same.
    const edited = withRole(withHelper, role("team", ["team:read"], ["helper"]));
    expect(mayDelegateMutation(withHelper, edited, actor, "role.save", "r-team")).toBe(false);
    // Adding Presidente to `team` also changes what `team-lead` gives.
    const parent = withRole(base, role("team", ["team:read"], ["presidente"]));
    expect(inheritedBuiltInRoles(parent, "team-lead")).toContain("presidente");
    expect(inheritedBuiltInRoleChanges(base, parent)).toEqual(["direttivo", "presidente", "socio"]);
  });

  it("refuses taking a built-in role back through the graph", () => {
    const dropped = withRole(withHelper, role("helper", [], []));
    expect(mayDelegateMutation(withHelper, dropped, actor, "role.save", helper.id)).toBe(false);
    const deleted = { ...withHelper, roles: withHelper.roles.filter((e) => e.id !== helper.id) };
    expect(mayDelegateMutation(withHelper, deleted, actor, "role.delete", helper.id)).toBe(false);
  });

  it("leaves Master Admin free to do all of it", () => {
    expect(mayDelegateMutation(base, withHelper, master, "role.save", helper.id)).toBe(true);
    expect(mayDelegateMutation(withHelper, withHelper, master, "role.assign", helper.id)).toBe(
      true,
    );
    expect(
      validateRoleDraft(
        { ...roleDraft("helper"), parents: [MASTER_ADMIN_ROLE_KEY] },
        {
          catalog: base,
        },
      ).parents,
    ).toMatch(/Master Admin/);
  });

  it("still allows ordinary edits and assignments, built-in parents included", () => {
    const created = withRole(base, role("helper", ["team:read"], ["team"]));
    expect(mayDelegateMutation(base, created, actor, "role.save", "r-helper")).toBe(true);
    expect(mayDelegateMutation(created, created, actor, "role.assign", "r-helper")).toBe(true);
    expect(mayDelegateMutation(created, created, actor, "role.unassign", "r-helper")).toBe(true);
    const deleted = { ...base, roles: base.roles.filter((e) => e.key !== "team-lead") };
    expect(mayDelegateMutation(base, deleted, actor, "role.delete", "r-team-lead")).toBe(true);
    // Changing what a Master-made `helper` grants leaves what it inherits alone.
    const granted = withRole(withHelper, role("helper", ["team:read"], ["presidente"]));
    expect(inheritedBuiltInRoleChanges(withHelper, granted)).toEqual([]);
    expect(mayDelegateMutation(withHelper, granted, actor, "role.save", helper.id)).toBe(true);
  });
});

function roleDraft(key: string) {
  return { key, name: key, description: "", parents: [] as string[], permissions: [] as string[] };
}
