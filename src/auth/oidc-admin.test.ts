import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("../env", () => ({ env: {} }));
vi.mock("../db/index", () => ({ db: {} }));
vi.mock("./membership", () => ({ checkEntraGroupMember: vi.fn() }));

import { createGroupMembershipCache, decideOidcAdmin } from "./oidc-admin";

describe("OIDC administrator policy", () => {
  it("denies a linked PN Entra account when no administrator group is configured", () => {
    expect(
      decideOidcAdmin({
        allowlisted: false,
        pnEntraAccount: true,
        groupConfigured: false,
        groupMember: false,
      }),
    ).toBe(false);
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

describe("bounded administrative revocation", () => {
  it("denies a removed member at the cache deadline and on lookup failure", async () => {
    let time = 0;
    const check = vi
      .fn()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(null);
    const member = createGroupMembershipCache(check, 60_000, () => time);
    expect(await member("admin-group", "removed-user")).toBe(true);
    time = 60_000;
    expect(await member("admin-group", "removed-user")).toBe(false);
    time = 120_000;
    expect(await member("admin-group", "removed-user")).toBe(false);
  });
  it("denies a positive response whose lookup outlives its authorization window", async () => {
    let time = 0;
    const member = createGroupMembershipCache(
      async () => {
        time = 60_001;
        return true;
      },
      60_000,
      () => time,
    );
    expect(await member("group", "user")).toBe(false);
  });
  it("does not let a late positive overwrite a newer denial", async () => {
    let time = 0;
    let finish!: (value: boolean) => void;
    const check = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<boolean>((resolve) => {
            finish = resolve;
          }),
      )
      .mockResolvedValue(false);
    const member = createGroupMembershipCache(check, 60_000, () => time);
    const old = member("group", "user");
    time = 10;
    expect(await member("group", "user")).toBe(false);
    finish(true);
    expect(await old).toBe(false);
    expect(await member("group", "user")).toBe(false);
  });
});
