import { describe, expect, it } from "vite-plus/test";
import type { RbacCatalog } from "@/auth/rbac";
import {
  canAssignRole,
  canGrantPermission,
  canGrantRole,
  canInheritFrom,
  confersBuiltInRole,
} from "./delegation";

const catalog: RbacCatalog = {
  permissions: ["read", "write"].map((key) => ({
    id: key,
    key,
    name: key,
    description: null,
    managed: false,
    implies: key === "write" ? ["read"] : [],
    roleCount: 0,
    createdAt: null,
    updatedAt: null,
  })),
  roles: ["writer", "inherited-writer"].map((key) => ({
    id: key,
    key,
    name: key,
    description: null,
    managed: false,
    sourceState: null,
    permissions: key === "writer" ? ["write"] : [],
    parents: key === "writer" ? [] : ["writer"],
    memberCount: 0,
    peopleBinding: null,
    createdAt: null,
    updatedAt: null,
  })),
};

describe("delegation choices", () => {
  it("requires the complete implied permission set", () => {
    expect(
      canGrantPermission({ isMasterAdmin: false, permissions: ["write"] }, catalog, "write"),
    ).toBe(false);
    expect(
      canGrantPermission(
        { isMasterAdmin: false, permissions: ["read", "write"] },
        catalog,
        "write",
      ),
    ).toBe(true);
  });

  it("includes inherited role permissions in the boundary", () => {
    expect(
      canGrantRole({ isMasterAdmin: false, permissions: ["read"] }, catalog, "inherited-writer"),
    ).toBe(false);
    expect(
      canGrantRole(
        { isMasterAdmin: false, permissions: ["read", "write"] },
        catalog,
        "inherited-writer",
      ),
    ).toBe(true);
  });

  it("lets Master Admin manage capabilities added after the access response", () => {
    const access = { isMasterAdmin: true, permissions: [] };
    expect(canGrantPermission(access, catalog, "write")).toBe(true);
    expect(canGrantRole(access, catalog, "inherited-writer")).toBe(true);
  });
});

describe("assigning the board offices", () => {
  const office = { ...catalog.roles[0]!, id: "presidente", key: "presidente", managed: true };
  const offices: RbacCatalog = { ...catalog, roles: [...catalog.roles, office] };
  const direttivo = { ...office, id: "direttivo", key: "direttivo" };

  it("is left to Master Admin, even for someone holding everything the office grants", () => {
    expect(canAssignRole({ isMasterAdmin: true, permissions: [] }, offices, office)).toBe(true);
    expect(
      canAssignRole({ isMasterAdmin: false, permissions: ["read", "write"] }, offices, office),
    ).toBe(false);
  });

  it("never covers built-in roles proven by evidence", () => {
    expect(canAssignRole({ isMasterAdmin: true, permissions: [] }, offices, direttivo)).toBe(false);
  });
});

describe("roles that inherit a built-in role", () => {
  const writer = catalog.roles[0]!;
  const presidente = { ...writer, id: "presidente", key: "presidente", managed: true };
  const helper = {
    ...writer,
    id: "helper",
    key: "helper",
    permissions: [],
    parents: ["presidente"],
  };
  const roles: RbacCatalog = { ...catalog, roles: [...catalog.roles, presidente, helper] };
  const delegate = { isMasterAdmin: false, permissions: ["read", "write"] };
  const master = { isMasterAdmin: true, permissions: [] };

  it("are not offered as parents to anyone but Master Admin", () => {
    expect(confersBuiltInRole(roles, helper)).toBe(true);
    expect(confersBuiltInRole(roles, writer)).toBe(false);
    for (const parent of [presidente, helper]) {
      expect(canGrantRole(delegate, roles, parent.key)).toBe(true);
      expect(canInheritFrom(delegate, roles, parent)).toBe(false);
      expect(canInheritFrom(master, roles, parent)).toBe(true);
    }
    expect(canInheritFrom(delegate, roles, writer)).toBe(true);
  });

  it("are given and taken back by Master Admin only", () => {
    expect(canAssignRole(delegate, roles, helper)).toBe(false);
    expect(canAssignRole(master, roles, helper)).toBe(true);
    expect(canAssignRole(delegate, roles, writer)).toBe(true);
  });
});
