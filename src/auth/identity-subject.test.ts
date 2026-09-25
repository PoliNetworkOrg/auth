import { describe, expect, it, vi } from "vite-plus/test";
const mocks = vi.hoisted(() => ({ check: vi.fn() }));
vi.mock("../env", () => ({
  env: { PN_ENTRA_TENANT_ID: "tenant", PN_ENTRA_MEMBER_GROUP_ID: "soci" },
}));
vi.mock("../db/index", () => ({ db: {} }));
vi.mock("./membership", () => ({ checkEntraGroupMember: mocks.check }));
vi.mock("./oidc-admin", () => ({
  canAdministerIdp: async () => false,
  createGroupMembershipCache: (check: unknown) => Object.assign(check!, { cached: () => false }),
}));
import { readIdentitySubject, type IdentityReader } from "./identity-subject";

function reader(proofs: unknown[], exists = true): IdentityReader {
  return {
    select: vi
      .fn()
      .mockReturnValueOnce({
        from: () => ({ where: async () => (exists ? [{ id: "user" }] : []) }),
      })
      .mockReturnValueOnce({ from: () => ({ innerJoin: () => ({ where: async () => proofs }) }) }),
  } as unknown as IdentityReader;
}
const proof = {
  issuer: "https://login.microsoftonline.com/tenant/v2.0",
  providerId: "pn-entra",
  externalId: "member",
  states: ["socio"],
  validUntil: new Date(Date.now() + 86_400_000),
  telegramId: null,
};

describe("authorization evidence trust and freshness", () => {
  it.each([false, null])(
    "denies stored unexpired membership when live verification returns %s",
    async (result) => {
      mocks.check.mockResolvedValue(result);
      expect((await readIdentitySubject("user", reader([proof]), true)).roleKeys).toEqual([]);
    },
  );
  it("denies another tenant's evidence even if membership checks would pass", async () => {
    mocks.check.mockResolvedValue(true);
    expect(
      (
        await readIdentitySubject(
          "user",
          reader([{ ...proof, issuer: "https://foreign.invalid" }]),
          true,
        )
      ).roleKeys,
    ).toEqual([]);
  });
  it("denies missing subjects before considering any evidence", async () => {
    await expect(readIdentitySubject("deleted-user", reader([proof], false))).rejects.toThrow();
  });
});
