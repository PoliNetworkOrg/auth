import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("./membership", () => ({ listEntraGroupMembers: vi.fn() }));

import { createGroupListingCache } from "./group-listing";

describe("cached group listings for the user directory", () => {
  it("shares one listing between concurrent requests and reuses it until it expires", async () => {
    let time = 0;
    const list = vi.fn(async () => new Set(["a"]));
    const members = createGroupListingCache(list, 60_000, () => time);
    const [first, second] = await Promise.all([members("soci"), members("soci")]);
    expect(first).toBe(second);
    expect(list).toHaveBeenCalledTimes(1);
    time = 59_999;
    await members("soci");
    expect(list).toHaveBeenCalledTimes(1);
    time = 60_000;
    await members("soci");
    expect(list).toHaveBeenCalledTimes(2);
  });

  it("never caches a failed listing", async () => {
    const list = vi
      .fn<(groupId: string) => Promise<Set<string> | null>>()
      .mockResolvedValueOnce(null)
      .mockRejectedValueOnce(new Error("Graph down"))
      .mockResolvedValueOnce(new Set(["a"]));
    const members = createGroupListingCache(list, 60_000, () => 0);
    expect(await members("soci")).toBeNull();
    expect(await members("soci")).toBeNull();
    expect(await members("soci")).toEqual(new Set(["a"]));
  });

  it("measures freshness from when the listing started", async () => {
    let time = 0;
    const list = vi.fn(async () => {
      time = 60_000;
      return new Set(["a"]);
    });
    const members = createGroupListingCache(list, 60_000, () => time);
    expect(await members("soci")).toEqual(new Set(["a"]));
    await members("soci");
    expect(list).toHaveBeenCalledTimes(2);
  });

  it("keeps groups apart", async () => {
    const list = vi.fn(async (groupId: string) => new Set([groupId]));
    const members = createGroupListingCache(list, 60_000, () => 0);
    expect(await members("soci")).toEqual(new Set(["soci"]));
    expect(await members("direttivo")).toEqual(new Set(["direttivo"]));
  });
});
