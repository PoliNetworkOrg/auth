import { describe, expect, it } from "vite-plus/test";
import {
  type PeopleRoleChange,
  PEOPLE_RULES,
  describePeopleBinding,
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
import { planPeopleCommand } from "./people-role-command";

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
    role("capo-admin", ["people:self"], "capo", ["admin"]),
    // Appoints Capo Admins, but can't add admins on its own.
    role("appointer", ["admin:access", "people:appoint", "people:self", "tg:trusted"]),
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
  it("reads admin, capo and team bindings", () => {
    expect(parsePeopleBinding("admin")).toEqual({ kind: "admin" });
    expect(parsePeopleBinding("capo")).toEqual({ kind: "capo" });
    expect(describePeopleBinding({ kind: "capo" })).toBe("Capo Admin");
    expect(parsePeopleBinding("team:events:lead")).toEqual({
      kind: "team",
      team: "events",
      role: "lead",
    });
  });

  it("rejects anything else", () => {
    for (const value of [
      null,
      "",
      "team:it",
      "team:IT:member",
      "team:it:owner",
      "admins",
      "capo:x",
    ])
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

  it("needs people:appoint for Capo Admins, and people:write for the admin role they inherit", () => {
    expect(change(["direttivo", "admin"], "capo-admin")).toBeNull();
    expect(change(["direttivo", "admin"], "capo-admin", { action: "unassign" })).toBeNull();
    expect(change(["hr-member", "admin"], "capo-admin")).toMatch(/Capo Admin needs people:appoint/);
    expect(change(["appointer"], "capo-admin")).toMatch(/people:write/);
    expect(change(["capo-admin"], "capo-admin")).toMatch(/people:appoint/);
  });

  it("has one delegation rule per binding kind", () => {
    expect(Object.keys(PEOPLE_RULES).sort()).toEqual(["admin", "capo", "team"]);
  });

  it("lets whoever made an assignment apply it when the invitee accepts", () => {
    // The backend sends the assigner as the actor: the invitee would be giving themselves a role.
    expect(change(["direttivo"], "design-member", { actorId: "assigner" })).toBeNull();
    expect(change(["direttivo"], "design-member", { actorId: "target" })).toMatch(/themselves/);
  });

  it("refuses roles granting permissions the actor lacks, except to Master Admin", () => {
    expect(change(["hr-member"], "admin")).toMatch(/tg:trusted/);
    expect(change(["direttivo"], "admin", { action: "unassign" })).toMatch(/tg:trusted/);
    expect(change(["direttivo", "admin"], "admin")).toBeNull();
    expect(change([MASTER_ADMIN_ROLE_KEY], "admin")).toBeNull();
  });
});

it("checks inherited organizational authority even when it grants no extra permission", () => {
  const wrapper = role("wrapper", ["people:self"], "team:it:member", ["design-lead"]);
  const extended = { ...catalog, roles: [...catalog.roles, wrapper] };
  for (const action of ["assign", "unassign"] as const) {
    expect(
      peopleRoleChangeProblem({
        catalog: extended,
        actorId: "actor",
        actor: resolveAccess(extended, ["hr-member"]),
        targetId: "target",
        role: wrapper,
        action,
      }),
    ).toMatch(/people:appoint/);
  }
});

it("plans a complete revocation and rejects authority still inherited from an unbound role", () => {
  const command = {
    id: "00000000-0000-4000-8000-000000000001",
    actor: "actor",
    sub: "target",
    reason: "Leaving",
    changes: [{ kind: "team" as const, team: "hr", role: null }],
  };
  const plan = planPeopleCommand(catalog, ["hr-lead", "hr-member"], command);
  expect(plan.changes).toHaveLength(2);
  expect(plan.result.held).toEqual([]);
  const inherited = {
    ...catalog,
    roles: [...catalog.roles, role("wrapper", [], null, ["hr-lead"])],
  };
  expect(() => planPeopleCommand(inherited, ["wrapper"], command)).toThrow(/inherited/);
});

it("demotes an inherited member correctly after taking back its directly assigned Lead", () => {
  const plan = planPeopleCommand(catalog, ["hr-lead"], {
    id: "00000000-0000-4000-8000-000000000002",
    actor: "actor",
    sub: "target",
    reason: "Demotion",
    changes: [{ kind: "team", team: "hr", role: "member" }],
  });
  expect(plan.result.assigned).toEqual(["hr-member"]);
});

it("refuses missing and ambiguous assignment bindings instead of choosing a different role", () => {
  const command = {
    id: "00000000-0000-4000-8000-000000000003",
    actor: "actor",
    sub: "target",
    reason: "Appointment",
    changes: [{ kind: "team" as const, team: "design", role: "lead" as const }],
  };
  expect(() =>
    planPeopleCommand(
      { ...catalog, roles: catalog.roles.filter((r) => r.key !== "design-lead") },
      [],
      command,
    ),
  ).toThrow(/exactly one/);
  expect(() =>
    planPeopleCommand(
      { ...catalog, roles: [...catalog.roles, role("another-lead", [], "team:design:lead")] },
      [],
      command,
    ),
  ).toThrow(/exactly one/);
});

describe("planPeopleCommand with Capo Admins", () => {
  const command = (changes: Parameters<typeof planPeopleCommand>[2]["changes"]) => ({
    id: "00000000-0000-4000-8000-000000000004",
    actor: "actor",
    sub: "target",
    reason: "Capo",
    changes,
  });

  it("appoints and ends a Capo Admin, who holds admin through it", () => {
    const appointed = planPeopleCommand(catalog, [], command([{ kind: "capo", active: true }]));
    expect(appointed.changes).toEqual([{ role: "capo-admin", action: "assign" }]);
    expect(appointed.result.held).toEqual(["admin", "capo-admin"]);
    const ended = planPeopleCommand(
      catalog,
      ["admin", "capo-admin"],
      command([{ kind: "capo", active: false }]),
    );
    expect(ended.changes).toEqual([{ role: "capo-admin", action: "unassign" }]);
    expect(ended.result.held).toEqual(["admin"]);
  });

  it("refuses to end the admin role a Capo Admin still holds through Capo", () => {
    expect(() =>
      planPeopleCommand(catalog, ["capo-admin"], command([{ kind: "admin", active: false }])),
    ).toThrow(/admin role is inherited/);
    const both = planPeopleCommand(
      catalog,
      ["capo-admin"],
      command([
        { kind: "capo", active: false },
        { kind: "admin", active: false },
      ]),
    );
    expect(both.result.held).toEqual([]);
  });

  it("refuses an admin mapping made ambiguous by binding another admin role", () => {
    const ambiguous = {
      ...catalog,
      roles: [...catalog.roles, role("trusted-admin", ["tg:trusted"], "admin", ["admin"])],
    };
    expect(() =>
      planPeopleCommand(ambiguous, [], command([{ kind: "admin", active: true }])),
    ).toThrow(/exactly one/);
  });
});
