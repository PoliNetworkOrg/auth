import { describe, expect, it } from "vite-plus/test";
import {
  hasAppRole,
  hasPolimiStudentDomain,
  identityStates,
  isLinkOnlyProvider,
  isLoginProvider,
  oidcIdentityClaims,
} from "./policy";
const now = new Date("2026-01-01T00:00:00Z");
const future = new Date("2026-01-01T01:00:00Z");

describe("identity states", () => {
  it("combines independently verified membership and student states", () => {
    expect(
      identityStates(
        [
          {
            providerId: "pn-entra",
            states: ["socio", "direttivo"],
            validUntil: future,
            telegramId: null,
          },
          { providerId: "polimi-email", states: ["student"], validUntil: future, telegramId: null },
        ],
        now,
      ),
    ).toEqual({ states: ["direttivo", "socio", "student"], telegramId: null });
  });
  it("does not turn a Telegram link into moderation access", () => {
    expect(
      identityStates(
        [{ providerId: "telegram", states: ["socio"], validUntil: future, telegramId: "123" }],
        now,
      ),
    ).toEqual({ states: [], telegramId: "123" });
  });
  it("rejects expired evidence and states from the wrong provider", () => {
    expect(
      identityStates(
        [
          { providerId: "pn-entra", states: ["socio"], validUntil: now, telegramId: null },
          { providerId: "polimi-email", states: ["socio"], validUntil: future, telegramId: null },
        ],
        now,
      ).states,
    ).toEqual([]);
  });
  it("requires an exact app role in a valid claim array", () => {
    expect(hasAppRole(["student"], "student")).toBe(true);
    for (const roles of [undefined, "student", ["student-admin"], ["student", 1]])
      expect(hasAppRole(roles, "student")).toBe(false);
  });
  it("removes all states without linked evidence", () => {
    expect(identityStates([], now)).toEqual({ states: [], telegramId: null });
  });
  it("adds string-only OIDC claims without changing the identity claim", () => {
    const identity = {
      states: ["socio", "student"],
      roles: ["socio", "student"],
      permissions: ["membership:read", "student:verified"],
      telegramId: "123456789",
    };
    expect(oidcIdentityClaims("https://auth.polinetwork.org/api/identity", identity)).toEqual({
      "https://auth.polinetwork.org/api/identity": identity,
      polinetwork_states: "socio student",
      polinetwork_roles: "socio student",
      polinetwork_permissions: "membership:read student:verified",
      polinetwork_telegram_id: "123456789",
    });
    expect(
      oidcIdentityClaims("identity", {
        states: [],
        roles: [],
        permissions: [],
        telegramId: null,
      }),
    ).toEqual({
      identity: { states: [], roles: [], permissions: [], telegramId: null },
      polinetwork_states: "",
      polinetwork_roles: "",
      polinetwork_permissions: "",
      polinetwork_telegram_id: "",
    });
  });
  it("accepts only the exact Polimi student email domain", () => {
    expect(hasPolimiStudentDomain("name@mail.polimi.it")).toBe(true);
    expect(hasPolimiStudentDomain("name@polimi.it")).toBe(false);
    expect(hasPolimiStudentDomain("name@mail.polimi.it.example.org")).toBe(false);
  });
  it("keeps verifier providers out of the login set", () => {
    expect(isLoginProvider("google")).toBe(true);
    expect(isLoginProvider("pn-entra")).toBe(true);
    expect(isLoginProvider("telegram")).toBe(false);
    expect(isLoginProvider("polimi-email")).toBe(false);
    expect(isLinkOnlyProvider("telegram")).toBe(true);
  });
});
