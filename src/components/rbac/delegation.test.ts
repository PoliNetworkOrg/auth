import { describe, expect, it } from "vite-plus/test";
import type { RbacCatalog } from "@/auth/rbac";
import { canAssignRole, canGrantPermission, canGrantRole } from "./delegation";

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
