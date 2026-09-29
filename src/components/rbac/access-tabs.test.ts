import { describe, expect, it } from "vite-plus/test";
import type { ManagedPermissionKey } from "@/auth/rbac";
import { ACCESS_TABS, firstAccessTab } from "./access-tabs";

const holding = (...held: ManagedPermissionKey[]) => {
  return (permission: ManagedPermissionKey) => held.includes(permission);
};

describe("where the Access section opens", () => {
  it("sends someone who may only read permissions to the permissions tab", () => {
    expect(firstAccessTab(holding("idp:permissions:read"))?.to).toBe("/access/permissions");
  });

  it("keeps roles as the landing tab for anyone who may read them", () => {
    expect(firstAccessTab(holding("idp:roles:read"))?.to).toBe("/access/roles");
    expect(firstAccessTab(holding("idp:roles:read", "idp:permissions:read"))?.to).toBe(
      "/access/roles",
    );
  });

  it("offers nothing when no tab is readable", () => {
    expect(firstAccessTab(holding())).toBeNull();
    expect(firstAccessTab(holding("idp:applications:write"))).toBeNull();
  });

  it("guards every tab with a permission", () => {
    for (const tab of ACCESS_TABS) expect(firstAccessTab(holding(tab.permission))).toBe(tab);
  });
});
