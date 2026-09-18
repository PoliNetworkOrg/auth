import { describe, expect, it } from "vite-plus/test";
import type { RbacCatalog } from "@/auth/rbac";
import { canGrantPermission, canGrantRole } from "./delegation";

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
