import { describe, expect, it, vi } from "vite-plus/test";
import type { PermissionSummary, RbacCatalog, RoleSummary } from "./rbac";

vi.mock("../env", () => ({
  env: { IDP_ADMIN_USER_IDS: ["root"], PN_ENTRA_TENANT_ID: "tenant" },
}));
vi.mock("../db", () => ({ db: {} }));
vi.mock("./membership", () => ({ listEntraGroupMembers: vi.fn() }));
vi.mock("./rbac-store", () => ({ readCatalog: vi.fn() }));

import { projectBackendCatalog, projectBackendSubjects } from "./access-snapshot";

const permission = (key: string, implies: string[] = []): PermissionSummary => ({
  id: key,
  key,
  name: key,
  description: null,
  managed: false,
  implies,
  roleCount: 0,
  createdAt: null,
  updatedAt: null,
});
const role = (
  key: string,
  permissions: string[],
  managed = false,
  parents: string[] = [],
): RoleSummary => ({
  id: key,
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
});

const catalog: RbacCatalog = {
  permissions: [
    permission("tg:read"),
    permission("tg:moderate", ["tg:read"]),
    permission("admin:access"),
    permission("idp:roles:write"),
  ],
  roles: [
    role("manual", ["tg:moderate"]),
    role("socio", ["tg:read"], true),
    role("student", ["tg:moderate"], true),
    role("master-admin", [], true),
  ],
};
const now = new Date("2026-10-08T10:00:00.000Z");
const groups = [{ source: "entra:soci", groupId: "soci-group", roleKey: "socio" }];
const pnProof = (userId: string, externalId: string) => ({
  userId,
  providerId: "pn-entra",
  issuer: "https://login.microsoftonline.com/tenant/v2.0",
  externalId,
  states: [],
  validUntil: new Date("2026-10-08T09:00:00.000Z"),
  telegramId: null,
});
const tgProof = (userId: string, telegramId: string) => ({
  userId,
  providerId: "telegram",
  issuer: "https://oauth.telegram.org",
  externalId: null,
  states: [],
  validUntil: new Date("2026-10-07T00:00:00.000Z"),
  telegramId,
});

describe("backend access projection", () => {
  it("merges rights by latest expiry and keeps permanent assignments permanent", () => {
    const subjects = projectBackendSubjects({
      users: ["manual-user", "student-user", "entra-user", "root", "no-rights"],
      manualRoles: [{ userId: "manual-user", roleKey: "manual" }],
      proofs: [
        pnProof("manual-user", "m"),
        pnProof("entra-user", "e"),
        tgProof("manual-user", "123456"),
        {
          userId: "student-user",
          providerId: "polimi-email",
          issuer: "https://mail.polimi.it",
          externalId: "student@mail.polimi.it",
          states: ["student"],
          validUntil: new Date("2026-10-08T10:30:00.000Z"),
          telegramId: null,
        },
      ],
      catalog,
      groups,
      observations: [
        {
          source: "entra:soci",
          groupId: "soci-group",
          members: ["m", "e"],
          observedAt: new Date("2026-10-08T09:30:00.000Z"),
        },
      ],
      now,
    });
    expect(subjects).toEqual([
      {
        sub: "entra-user",
        telegramId: null,
        roles: { socio: { validUntil: "2026-10-08T10:30:00.000Z" } },
        permissions: { "tg:read": { validUntil: "2026-10-08T10:30:00.000Z" } },
      },
      {
        sub: "manual-user",
        telegramId: "123456",
        roles: {
          manual: { validUntil: null },
          socio: { validUntil: "2026-10-08T10:30:00.000Z" },
        },
        permissions: {
          "tg:moderate": { validUntil: null },
          "tg:read": { validUntil: null },
        },
      },
      {
        sub: "root",
        telegramId: null,
        roles: { "master-admin": { validUntil: null } },
        permissions: {
          "admin:access": { validUntil: null },
          "tg:moderate": { validUntil: null },
          "tg:read": { validUntil: null },
        },
      },
      {
        sub: "student-user",
        telegramId: null,
        roles: { student: { validUntil: "2026-10-08T10:30:00.000Z" } },
        permissions: {
          "tg:moderate": { validUntil: "2026-10-08T10:30:00.000Z" },
          "tg:read": { validUntil: "2026-10-08T10:30:00.000Z" },
        },
      },
    ]);
  });

  it("drops expired authority and excludes duplicate Telegram IDs", () => {
    const subjects = projectBackendSubjects({
      users: ["a", "b", "c"],
      manualRoles: ["a", "b", "c"].map((userId) => ({ userId, roleKey: "manual" })),
      proofs: [tgProof("a", "42"), tgProof("b", "42"), tgProof("c", "99"), tgProof("c", "100")],
      catalog,
      groups,
      observations: [
        {
          source: "entra:soci",
          groupId: "soci-group",
          members: ["a"],
          observedAt: new Date("2026-10-08T08:59:59.000Z"),
        },
      ],
      now,
    });
    expect(subjects.map(({ telegramId }) => telegramId)).toEqual([null, null, null]);
    expect(subjects[0]?.permissions["tg:read"]).toEqual({ validUntil: null });
  });

  it("carries permissions created in the dashboard but never the identity provider's own", () => {
    const subjects = projectBackendSubjects({
      users: ["signer"],
      manualRoles: [{ userId: "signer", roleKey: "secretary" }],
      proofs: [],
      catalog: {
        permissions: [permission("esign:sign"), permission("idp:roles:write")],
        roles: [role("secretary", ["esign:sign", "idp:roles:write"])],
      },
      groups: [],
      observations: [],
      now,
    });
    expect(subjects).toEqual([
      {
        sub: "signer",
        telegramId: null,
        roles: { secretary: { validUntil: null } },
        permissions: { "esign:sign": { validUntil: null } },
      },
    ]);
  });

  it("carries inherited roles with the latest expiry among the paths that grant them", () => {
    const studentProof = (userId: string, validUntil: string) => ({
      userId,
      providerId: "polimi-email",
      issuer: "https://mail.polimi.it",
      externalId: `${userId}@mail.polimi.it`,
      states: ["student"],
      validUntil: new Date(validUntil),
      telegramId: null,
    });
    const subjects = projectBackendSubjects({
      users: ["both", "board", "expired", "legacy"],
      manualRoles: [
        { userId: "board", roleKey: "board" },
        { userId: "legacy", roleKey: "legacy" },
      ],
      proofs: [
        pnProof("both", "b"),
        studentProof("both", "2026-10-08T11:00:00.000Z"),
        studentProof("expired", "2026-10-08T09:59:59.000Z"),
      ],
      catalog: {
        permissions: [permission("tg:read"), permission("tg:moderate")],
        roles: [
          role("member", ["tg:read"]),
          role("board", ["tg:moderate"], false, ["member"]),
          role("legacy", ["tg:read"], false, ["master-admin"]),
          role("socio", [], true, ["member"]),
          role("student", [], true, ["member"]),
          role("master-admin", [], true),
        ],
      },
      groups,
      observations: [
        {
          source: "entra:soci",
          groupId: "soci-group",
          members: ["b"],
          observedAt: new Date("2026-10-08T09:30:00.000Z"),
        },
      ],
      now,
    });
    expect(subjects.map(({ sub, roles }) => ({ sub, roles }))).toEqual([
      { sub: "board", roles: { board: { validUntil: null }, member: { validUntil: null } } },
      {
        sub: "both",
        roles: {
          member: { validUntil: "2026-10-08T11:00:00.000Z" },
          socio: { validUntil: "2026-10-08T10:30:00.000Z" },
          student: { validUntil: "2026-10-08T11:00:00.000Z" },
        },
      },
      { sub: "legacy", roles: { legacy: { validUntil: null } } },
    ]);
  });
});

describe("backend access catalog", () => {
  it("names every role and only the permissions the projection carries, by key", () => {
    expect(
      projectBackendCatalog({
        ...catalog,
        permissions: catalog.permissions.map((entry) =>
          entry.key === "tg:read" ? { ...entry, name: "Read groups" } : entry,
        ),
      }),
    ).toEqual({
      roles: [
        { key: "manual", name: "manual" },
        { key: "master-admin", name: "master-admin" },
        { key: "socio", name: "socio" },
        { key: "student", name: "student" },
      ],
      permissions: [
        { key: "admin:access", name: "admin:access" },
        { key: "tg:moderate", name: "tg:moderate" },
        { key: "tg:read", name: "Read groups" },
      ],
    });
  });
});
