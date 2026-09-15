import { describe, expect, it } from "vite-plus/test";
import {
  type PermissionSummary,
  type RbacCatalog,
  type RoleSummary,
  STATIC_ROLES,
  effectiveRolePermissions,
  expandPermissionKeys,
  expandRoleKeys,
  isStaticRoleKey,
  resolveAccess,
  roleParentWouldCycle,
  staticRolesForStates,
  validatePermissionDraft,
  validateRoleDraft,
} from "./rbac";

function permission(key: string, implies: string[] = []): PermissionSummary {
  return {
    id: `p-${key}`,
    key,
    name: key,
    description: null,
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

  it("covers Socio, Direttivo, and Student", () => {
    expect(STATIC_ROLES.map((entry) => entry.key)).toEqual(["socio", "direttivo", "student"]);
    for (const key of ["socio", "direttivo", "student"]) expect(isStaticRoleKey(key)).toBe(true);
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
