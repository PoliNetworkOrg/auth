import { describe, expect, it, vi } from "vite-plus/test";
import type { PermissionSummary, RbacCatalog, RoleSummary } from "./rbac";

vi.mock("../env", () => ({
  env: { IDP_ADMIN_USER_IDS: ["root"], PN_ENTRA_TENANT_ID: "tenant" },
}));
vi.mock("../db", () => ({ db: {} }));
vi.mock("./membership", () => ({ listEntraGroupMembers: vi.fn() }));
vi.mock("./rbac-store", () => ({ readCatalog: vi.fn() }));

import { projectBackendSubjects } from "./access-snapshot";

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
const role = (key: string, permissions: string[], managed = false): RoleSummary => ({
  id: key,
  key,
  name: key,
  description: null,
  managed,
  sourceState: managed ? key : null,
  permissions,
  parents: [],
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
        permissions: { "tg:read": { validUntil: "2026-10-08T10:30:00.000Z" } },
      },
      {
        sub: "manual-user",
        telegramId: "123456",
        permissions: {
          "tg:moderate": { validUntil: null },
          "tg:read": { validUntil: null },
        },
      },
      {
        sub: "root",
        telegramId: null,
        permissions: {
          "admin:access": { validUntil: null },
          "tg:moderate": { validUntil: null },
          "tg:read": { validUntil: null },
        },
      },
      {
        sub: "student-user",
        telegramId: null,
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
});
