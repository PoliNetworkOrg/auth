import { describe, expect, it } from "vite-plus/test";
import { groupByPrefix } from "./access-panels";
import { scramble } from "./secret-text";
import { describeAgent } from "./sessions-panel";

describe("hidden debug values", () => {
  it("keeps none of the value's letters or digits in the stand-in", () => {
    const value = "gRJpPF7dPqD45sMAzYRYCgsQcECCFCUu";
    const standIn = scramble(value);
    expect(standIn).toHaveLength(value.length);
    // The same filler at every position, whatever the value: it can't be decoded back.
    expect(scramble("a".repeat(value.length))).toBe(standIn);
  });

  it("keeps the layout so the blur reads like the real text", () => {
    expect(scramble("127.0.0.1")).toMatch(/^\w{3}\.\w\.\w\.\w$/);
    expect(scramble("Mozilla/5.0 (Macintosh)")).toMatch(/^\w+\/\w\.\w \(\w+\)$/);
  });
});

describe("session device names", () => {
  it.each([
    [
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36",
      "Chrome on macOS",
      false,
    ],
    [
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1",
      "Safari on iOS",
      true,
    ],
    [
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0",
      "Edge on Windows",
      false,
    ],
    [
      "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36",
      "Chrome on Android",
      true,
    ],
    [
      "Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0",
      "Firefox on Linux",
      false,
    ],
  ])("names %s", (agent, label, phone) => {
    expect(describeAgent(agent)).toEqual({ label, phone });
  });

  it("names a session without a user agent", () => {
    expect(describeAgent(null).label).toBe("Unknown device");
  });
});

describe("permission groups", () => {
  it("buckets permissions by the prefix of their key, in key order", () => {
    const groups = groupByPrefix([
      { key: "tg:bot:add", name: "Add the bot to groups" },
      { key: "idp:users:read", name: "View users" },
      { key: "idp:roles:read", name: "View roles" },
    ]);
    expect(groups.map(([prefix, entries]) => [prefix, entries.map((entry) => entry.key)])).toEqual([
      ["idp", ["idp:roles:read", "idp:users:read"]],
      ["tg", ["tg:bot:add"]],
    ]);
  });
});
