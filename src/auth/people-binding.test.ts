import { describe, expect, it } from "vite-plus/test";
import {
  type PeopleRoleChange,
  parsePeopleBinding,
  peopleBindingProblem,
  peopleRoleChangeProblem,
} from "./people-binding";
import {
  type PermissionSummary,
  type RbacCatalog,
  type RoleSummary,
  MASTER_ADMIN_ROLE_KEY,
  resolveAccess,
} from "./rbac";

function permission(key: string, managed = false): PermissionSummary {
  return {
    id: `p-${key}`,
    key,
    name: key,
    description: null,
    managed,
    implies: [],
    roleCount: 0,
    createdAt: null,
    updatedAt: null,
  };
}

function role(
  key: string,
  permissions: string[],
  peopleBinding: string | null = null,
  parents: string[] = [],
): RoleSummary {
  return {
    id: `r-${key}`,
    key,
    name: key,
    description: null,
    managed: key === MASTER_ADMIN_ROLE_KEY,
    sourceState: null,
    permissions,
    parents,
    memberCount: 0,
    peopleBinding,
    createdAt: null,
    updatedAt: null,
  };
}

const catalog: RbacCatalog = {
  permissions: [
    "admin:access",
    "people:self",
    "people:read",
    "people:write",
    "people:appoint",
    "tg:trusted",
  ]
    .map((key) => permission(key))
    .concat(permission("idp:roles:write", true)),
  roles: [
    role(MASTER_ADMIN_ROLE_KEY, []),
    role("direttivo", [
      "admin:access",
      "people:read",
      "people:write",
      "people:appoint",
      "people:self",
    ]),
    role(
      "hr-member",
      ["admin:access", "people:read", "people:write", "people:self"],
      "team:hr:member",
    ),
    role("hr-lead", ["people:self"], "team:hr:lead", ["hr-member"]),
    role("design-member", ["people:self"], "team:design:member"),
    role("design-lead", ["people:self"], "team:design:lead"),
    role("admin", ["tg:trusted"], "admin"),
    role("sneaky", ["idp:roles:write"], "team:it:member"),
    role("unbound", ["people:self"]),
  ],
};

const byKey = (key: string) => catalog.roles.find((entry) => entry.key === key)!;

function change(
  actorRoles: string[],
  roleKey: string,
  overrides: Partial<PeopleRoleChange> = {},
): string | null {
  return peopleRoleChangeProblem({
    catalog,
    actorId: "actor",
    actor: resolveAccess(catalog, actorRoles),
    targetId: "target",
    role: byKey(roleKey),
    action: "assign",
    ...overrides,
  });
}

describe("parsePeopleBinding", () => {
  it("reads admin and team bindings", () => {
    expect(parsePeopleBinding("admin")).toEqual({ kind: "admin" });
    expect(parsePeopleBinding("team:events:lead")).toEqual({
      kind: "team",
      team: "events",
      role: "lead",
    });
  });

  it("rejects anything else", () => {
    for (const value of [null, "", "team:it", "team:IT:member", "team:it:owner", "admins"])
      expect(parsePeopleBinding(value)).toBeNull();
  });
});

describe("peopleBindingProblem", () => {
  it("refuses roles that carry identity provider permissions", () => {
    expect(peopleBindingProblem(catalog, byKey("sneaky"))).toMatch(/identity provider/);
    expect(peopleBindingProblem(catalog, byKey("design-member"))).toBeNull();
  });
});

describe("peopleRoleChangeProblem", () => {
  it("refuses roles People doesn't manage", () => {
    expect(change(["direttivo"], "unbound")).toMatch(/not managed/);
    expect(change([MASTER_ADMIN_ROLE_KEY], "sneaky")).toMatch(/identity provider/);
  });

  it("never lets someone give themselves a role, but lets them give one up", () => {
    expect(change(["direttivo"], "design-member", { targetId: "actor" })).toMatch(/themselves/);
    expect(change([MASTER_ADMIN_ROLE_KEY], "admin", { targetId: "actor" })).toMatch(/themselves/);
    expect(change([], "design-lead", { targetId: "actor", action: "unassign" })).toBeNull();
  });

  it("needs people:write for members and admins, people:appoint for Leads", () => {
    expect(change(["hr-member"], "design-member")).toBeNull();
    expect(change(["hr-member"], "design-lead")).toMatch(/people:appoint/);
    expect(change(["direttivo"], "design-lead")).toBeNull();
    expect(change(["design-member"], "design-member")).toMatch(/people:write/);
  });

  it("lets a Lead change their own team's members only", () => {
    expect(change(["design-lead"], "design-member")).toBeNull();
    expect(change(["design-lead"], "design-member", { action: "unassign" })).toBeNull();
    expect(change(["design-lead"], "hr-member")).toMatch(/people:write/);
    expect(change(["design-lead"], "design-lead")).toMatch(/people:appoint/);
  });

  it("keeps an HR member from making anyone the HR Lead", () => {
    expect(change(["hr-member"], "hr-lead")).toMatch(/people:appoint/);
  });

  it("refuses roles granting permissions the actor lacks, except to Master Admin", () => {
    expect(change(["hr-member"], "admin")).toMatch(/tg:trusted/);
    expect(change(["direttivo"], "admin", { action: "unassign" })).toMatch(/tg:trusted/);
    expect(change(["direttivo", "admin"], "admin")).toBeNull();
    expect(change([MASTER_ADMIN_ROLE_KEY], "admin")).toBeNull();
  });
});
