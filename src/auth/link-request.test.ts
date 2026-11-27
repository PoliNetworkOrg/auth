import { describe, expect, it } from "vite-plus/test";
import {
  isLinkMethod,
  linkErrorFromCallback,
  linkPagePath,
  trustedReturnTo,
  withLinkOutcome,
} from "./link-request";

const dashboard = ["https://admin.polinetwork.org/api/auth/callback/polinetwork"];

describe("trustedReturnTo", () => {
  it("accepts any path on the origin of a registered redirect URI", () => {
    expect(trustedReturnTo("https://admin.polinetwork.org/me?tab=setup#top", dashboard)).toBe(
      "https://admin.polinetwork.org/me?tab=setup#top",
    );
    expect(trustedReturnTo("https://admin.polinetwork.org", dashboard)).toBe(
      "https://admin.polinetwork.org/",
    );
  });

  it("checks every registered redirect URI", () => {
    const uris = ["https://polinet.cc/callback", "https://admin.polinetwork.org/callback"];
    expect(trustedReturnTo("https://admin.polinetwork.org/me", uris)).toBe(
      "https://admin.polinetwork.org/me",
    );
  });

  it("refuses foreign origins", () => {
    for (const returnTo of [
      "https://evil.example/me",
      "https://polinetwork.org/me",
      "https://sub.admin.polinetwork.org/me",
      "https://admin.polinetwork.org.evil.example/me",
    ])
      expect(trustedReturnTo(returnTo, dashboard), returnTo).toBeNull();
  });

  it("refuses another scheme or port on the same host", () => {
    expect(trustedReturnTo("http://admin.polinetwork.org/me", dashboard)).toBeNull();
    expect(trustedReturnTo("https://admin.polinetwork.org:8443/me", dashboard)).toBeNull();
  });

  it("refuses path and authority tricks", () => {
    for (const returnTo of [
      "/me",
      "//evil.example/me",
      "/\\evil.example",
      "https://admin.polinetwork.org@evil.example/me",
      "https://evil.example\\@admin.polinetwork.org/me",
      "https://evil.example#https://admin.polinetwork.org/",
      "https://evil.example/?next=https://admin.polinetwork.org/",
      "https://user:pass@admin.polinetwork.org/me",
      "javascript:alert(1)//https://admin.polinetwork.org/",
      "data:text/html,https://admin.polinetwork.org/",
      " https://evil.example/",
    ])
      expect(trustedReturnTo(returnTo, dashboard), returnTo).toBeNull();
  });

  it("refuses everything without a return address or registered web origins", () => {
    expect(trustedReturnTo(undefined, dashboard)).toBeNull();
    expect(trustedReturnTo("", dashboard)).toBeNull();
    expect(trustedReturnTo("https://admin.polinetwork.org/me", [])).toBeNull();
    // An app scheme has no origin to share: it must never match anything.
    expect(trustedReturnTo("com.example.app:/me", ["com.example.app:/callback"])).toBeNull();
    expect(trustedReturnTo("https://admin.polinetwork.org/", ["not a url"])).toBeNull();
  });

  it("accepts loopback only when the application registered it", () => {
    expect(trustedReturnTo("http://localhost:3000/me", ["http://localhost:3000/cb"])).toBe(
      "http://localhost:3000/me",
    );
    expect(trustedReturnTo("http://localhost:3001/me", ["http://localhost:3000/cb"])).toBeNull();
  });
});

describe("withLinkOutcome", () => {
  it("adds linked or link_error, keeping the rest of the address", () => {
    expect(
      withLinkOutcome("https://admin.polinetwork.org/me?tab=a#x", { linked: "telegram" }),
    ).toBe("https://admin.polinetwork.org/me?tab=a&linked=telegram#x");
    expect(withLinkOutcome("https://admin.polinetwork.org/me", { error: "cancelled" })).toBe(
      "https://admin.polinetwork.org/me?link_error=cancelled",
    );
  });

  it("replaces an outcome already in the address", () => {
    expect(
      withLinkOutcome("https://admin.polinetwork.org/me?linked=google&link_error=failed", {
        error: "account_in_use",
      }),
    ).toBe("https://admin.polinetwork.org/me?link_error=account_in_use");
    expect(
      withLinkOutcome("https://admin.polinetwork.org/me?link%5Ferror=failed&tab=a", {
        linked: "google",
      }),
    ).toBe("https://admin.polinetwork.org/me?tab=a&linked=google");
  });

  it("keeps the application's own query as written", () => {
    expect(
      withLinkOutcome("https://admin.polinetwork.org/me?q=a%20b&flag&next=/x/y&linked=google", {
        linked: "telegram",
      }),
    ).toBe("https://admin.polinetwork.org/me?q=a%20b&flag&next=/x/y&linked=telegram");
  });
});

describe("linkErrorFromCallback", () => {
  it("maps cancelling at the provider", () => {
    expect(linkErrorFromCallback("access_denied")).toBe("cancelled");
    expect(linkErrorFromCallback("user_cancelled")).toBe("cancelled");
  });

  it("maps a login that belongs to another user", () => {
    expect(linkErrorFromCallback("account_already_linked_to_different_user")).toBe(
      "account_in_use",
    );
  });

  it("maps everything else to failed", () => {
    expect(linkErrorFromCallback("unable_to_get_user_info")).toBe("failed");
    expect(linkErrorFromCallback("state_mismatch")).toBe("failed");
    expect(linkErrorFromCallback(undefined)).toBe("failed");
  });
});

describe("isLinkMethod", () => {
  it("knows the three methods and nothing inherited", () => {
    expect(["telegram", "pn-entra", "google"].every(isLinkMethod)).toBe(true);
    for (const value of ["polimi-email", "toString", "__proto__", "", 1, null])
      expect(isLinkMethod(value)).toBe(false);
  });
});

describe("linkPagePath", () => {
  it("is a relative path that Better Auth accepts as a callback", () => {
    const request = {
      method: "telegram" as const,
      clientId: "dashboard",
      returnTo: "https://admin.polinetwork.org/me?tab=setup",
    };
    const path = linkPagePath(request, "linked");
    expect(path.startsWith("/link?")).toBe(true);
    expect(path).not.toMatch(/^\/\/|\\/);
    const search = new URL(path, "https://auth.polinetwork.org").searchParams;
    expect(Object.fromEntries(search)).toEqual({
      method: "telegram",
      client_id: "dashboard",
      return_to: "https://admin.polinetwork.org/me?tab=setup",
      result: "linked",
    });
    expect(linkPagePath({ method: "google" })).toBe("/link?method=google");
  });
});
