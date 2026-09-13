import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("../env", () => ({ env: {} }));
vi.mock("../db/index", () => ({ db: {} }));
vi.mock("./membership", () => ({ checkEntraGroupMember: vi.fn() }));

import { createGroupMembershipCache, decideOidcAdmin } from "./oidc-admin";

describe("OIDC administrator policy", () => {
  it("lets any PN Entra account manage clients until a stricter group is configured", () => {
    expect(
      decideOidcAdmin({
        allowlisted: false,
        pnEntraAccount: true,
        groupConfigured: false,
        groupMember: false,
      }),
    ).toBe(true);
  });

  it("requires membership of the stricter group once configured", () => {
    const base = { allowlisted: false, pnEntraAccount: true, groupConfigured: true };
    expect(decideOidcAdmin({ ...base, groupMember: false })).toBe(false);
    expect(decideOidcAdmin({ ...base, groupMember: true })).toBe(true);
  });

  it("denies users without a PN Entra account", () => {
    expect(
      decideOidcAdmin({
        allowlisted: false,
        pnEntraAccount: false,
        groupConfigured: false,
        groupMember: false,
      }),
    ).toBe(false);
  });

  it("keeps the explicit allowlist as a break-glass path", () => {
    expect(
      decideOidcAdmin({
        allowlisted: true,
        pnEntraAccount: false,
        groupConfigured: true,
        groupMember: false,
      }),
    ).toBe(true);
  });
});

describe("group membership cache", () => {
  it("reuses a confirmed answer within the interval and rechecks after it", async () => {
    let time = 0;
    const check = vi.fn().mockResolvedValue(true);
    const isMember = createGroupMembershipCache(check, 1000, () => time);
    expect(await isMember("group", "user")).toBe(true);
    expect(await isMember("group", "user")).toBe(true);
    expect(check).toHaveBeenCalledTimes(1);
    time = 1001;
    expect(await isMember("group", "user")).toBe(true);
    expect(check).toHaveBeenCalledTimes(2);
  });

  it("caches nonmembership but never a failed check", async () => {
    const check = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(false);
    const isMember = createGroupMembershipCache(check, 1000, () => 0);
    expect(await isMember("group", "user")).toBe(false);
    expect(await isMember("group", "user")).toBe(false);
    expect(await isMember("group", "user")).toBe(false);
    expect(check).toHaveBeenCalledTimes(2);
  });

  it("keeps different groups and users apart", async () => {
    const check = vi.fn(async (_group: string, objectId: string) => objectId === "admin");
    const isMember = createGroupMembershipCache(check, 1000, () => 0);
    expect(await isMember("group", "admin")).toBe(true);
    expect(await isMember("group", "other")).toBe(false);
    expect(check).toHaveBeenCalledTimes(2);
  });
});
