import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({ get: vi.fn(), credential: vi.fn() }));
vi.mock("../env", () => ({
  env: {
    PN_ENTRA_TENANT_ID: "pn-tenant",
    PN_ENTRA_CLIENT_ID: "pn-app",
    PN_ENTRA_CLIENT_SECRET: "pn-secret",
    PN_ENTRA_MEMBER_GROUP_ID: "soci",
    PN_ENTRA_DIRETTIVO_GROUP_ID: "direttivo",
    PN_ENTRA_MEMBER_REFRESH_HOURS: 24,
  },
}));
vi.mock("@azure/identity", () => ({
  ClientSecretCredential: class {
    constructor(...args: unknown[]) {
      mocks.credential(...args);
    }
  },
}));
vi.mock("@microsoft/microsoft-graph-client", () => ({
  Client: { initWithMiddleware: () => ({ api: () => ({ get: mocks.get }) }) },
}));

import { checkPnGroupStates, membershipEvidence, readGroupMembership } from "./membership";

describe("PN membership verification", () => {
  beforeEach(() => {
    mocks.get.mockReset();
  });

  it("uses PN credentials without mail sender credentials", async () => {
    mocks.get.mockResolvedValue({ value: [{ id: "member" }] });
    expect(await checkPnGroupStates("member")).toEqual(["socio", "direttivo"]);
    expect(mocks.credential).toHaveBeenCalledWith("pn-tenant", "pn-app", "pn-secret");
  });

  it("finds members on subsequent Graph pages", async () => {
    const get = vi
      .fn()
      .mockResolvedValueOnce({ value: [{ id: "other" }], "@odata.nextLink": "next-page" })
      .mockResolvedValueOnce({ value: [{ id: "member" }] });
    expect(await readGroupMembership(get, "soci", "member")).toBe(true);
    expect(get).toHaveBeenNthCalledWith(2, "next-page");
  });

  it("confirms absence only after checking all pages", async () => {
    const get = vi
      .fn()
      .mockResolvedValueOnce({ value: [{ id: "other" }], "@odata.nextLink": "next-page" })
      .mockResolvedValueOnce({ value: [] });
    expect(await readGroupMembership(get, "soci", "member")).toBe(false);
    expect(get).toHaveBeenCalledTimes(2);
  });

  it.each([403, 404, 429, 500])(
    "keeps Graph HTTP %i distinct from nonmembership",
    async (statusCode) => {
      mocks.get.mockRejectedValue(
        Object.assign(new Error("private error details"), { statusCode }),
      );
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      try {
        expect(await checkPnGroupStates("member")).toBeNull();
        expect(warn).toHaveBeenCalled();
        expect(JSON.stringify(warn.mock.calls)).not.toContain("private error details");
      } finally {
        warn.mockRestore();
      }
    },
  );

  it("reports each group separately and only what Graph confirmed", async () => {
    mocks.get
      .mockResolvedValueOnce({ value: [{ id: "member" }] })
      .mockResolvedValueOnce({ value: [{ id: "someone-else" }] });
    expect(await checkPnGroupStates("member")).toEqual(["socio"]);
  });

  it("does not cache failed checks for a full membership interval", () => {
    const now = new Date("2026-09-07T00:00:00Z");
    expect(membershipEvidence(null, now)).toEqual({ states: [], validUntil: now });
    expect(membershipEvidence(["socio", "direttivo"], now)).toEqual({
      states: ["socio", "direttivo"],
      validUntil: new Date("2026-09-08T00:00:00Z"),
    });
    expect(membershipEvidence([], now)).toEqual({
      states: [],
      validUntil: new Date("2026-09-08T00:00:00Z"),
    });
  });
});
