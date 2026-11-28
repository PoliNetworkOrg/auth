import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("../db", () => ({ db: {} }));

import {
  SESSION_FRESH_AGE,
  shouldConfirmName,
  shouldOfferPasskey,
  type PasskeyPromptState,
} from "./post-login";

const now = Date.parse("2026-10-15T12:00:00Z");
const fresh: PasskeyPromptState = {
  hasPasskey: false,
  declined: false,
  unsupportedBrowser: false,
  sessionCreatedAt: new Date(now - 5_000),
  prompt: null,
};

describe("passkey offer", () => {
  it("is offered right after someone without a passkey signs in", () => {
    expect(shouldOfferPasskey(fresh, now)).toBe(true);
    expect(shouldOfferPasskey({ ...fresh, prompt: "consent" }, now)).toBe(true);
  });

  it("is not offered to someone who has a passkey or skipped it once", () => {
    expect(shouldOfferPasskey({ ...fresh, hasPasskey: true }, now)).toBe(false);
    expect(shouldOfferPasskey({ ...fresh, declined: true }, now)).toBe(false);
  });

  it("is not offered in a browser that cannot create passkeys", () => {
    expect(shouldOfferPasskey({ ...fresh, unsupportedBrowser: true }, now)).toBe(false);
  });

  it("never interrupts a silent sign-in", () => {
    expect(shouldOfferPasskey({ ...fresh, prompt: "none" }, now)).toBe(false);
  });

  it("is not offered once the session is too old to register a passkey", () => {
    const createdAt = (ageSeconds: number) => new Date(now - ageSeconds * 1000);
    expect(
      shouldOfferPasskey({ ...fresh, sessionCreatedAt: createdAt(SESSION_FRESH_AGE - 60) }, now),
    ).toBe(true);
    expect(
      shouldOfferPasskey({ ...fresh, sessionCreatedAt: createdAt(SESSION_FRESH_AGE) }, now),
    ).toBe(false);
  });
});

describe("name confirmation", () => {
  it("stops an app sign-in until a self-declared name is confirmed", () => {
    expect(shouldConfirmName({ nameUnconfirmed: true, prompt: null })).toBe(true);
    expect(shouldConfirmName({ nameUnconfirmed: true, prompt: "consent" })).toBe(true);
    expect(shouldConfirmName({ nameUnconfirmed: false, prompt: null })).toBe(false);
  });

  it("never interrupts a silent sign-in", () => {
    expect(shouldConfirmName({ nameUnconfirmed: true, prompt: "none" })).toBe(false);
  });
});
