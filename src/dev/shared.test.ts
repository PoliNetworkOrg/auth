import { describe, expect, it } from "vite-plus/test";
import { devLoginHref, localRedirect } from "./shared";

describe("dev sign-in redirect", () => {
  it.each(["/", "/users", "/users?socio=yes#top", "/api/auth/oauth2/authorize?client_id=x"])(
    "keeps the local path %s",
    (path) => {
      expect(localRedirect(path)).toBe(path);
    },
  );

  it.each([
    null,
    "",
    "users",
    "https://evil.example/",
    "//evil.example/",
    "/\\evil.example/",
    "javascript:alert(1)",
  ])("falls back to the home page for %j", (value) => {
    expect(localRedirect(value)).toBe("/");
  });

  it("builds a link that survives the round trip", () => {
    const url = new URL(devLoginHref("staff", "/users?socio=yes&page=2"), "http://localhost");
    expect(url.pathname).toBe("/api/dev/login");
    expect(url.searchParams.get("as")).toBe("staff");
    expect(localRedirect(url.searchParams.get("redirect"))).toBe("/users?socio=yes&page=2");
  });
});
