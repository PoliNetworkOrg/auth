import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const searchPeople = vi.hoisted(() => vi.fn());
vi.mock("@/auth/rbac.functions", () => ({ searchPeople }));

import { holdsRoleAfterUnassign } from "./role-membership";

const person = (id: string, holdsRole: boolean) => ({
  id,
  name: id,
  email: null,
  image: null,
  holdsRole,
});

describe("membership after removing a direct assignment", () => {
  beforeEach(() => {
    searchPeople.mockReset();
  });

  it("asks the server about that person within the role", async () => {
    searchPeople.mockResolvedValue([person("alice", true)]);
    expect(await holdsRoleAfterUnassign("admin", "alice")).toBe(true);
    expect(searchPeople).toHaveBeenCalledWith({ data: { query: "alice", roleId: "admin" } });
  });

  it("drops someone whose inherited source was removed meanwhile", async () => {
    searchPeople.mockResolvedValue([person("alice", false)]);
    expect(await holdsRoleAfterUnassign("admin", "alice")).toBe(false);
  });

  it("ignores other people the search happens to match", async () => {
    searchPeople.mockResolvedValue([person("alice-2", true), person("alice", false)]);
    expect(await holdsRoleAfterUnassign("admin", "alice")).toBe(false);
  });

  it("treats a search the writer may no longer make as not holding the role", async () => {
    searchPeople.mockRejectedValue(new Error("Forbidden"));
    expect(await holdsRoleAfterUnassign("admin", "alice")).toBe(false);
  });
});
