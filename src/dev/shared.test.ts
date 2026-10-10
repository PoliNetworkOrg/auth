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

  // Each of these resolves, or is read by browsers, as a protocol-relative URL to another host.
  it.each([
    "/a/..//evil.example",
    "/a/%2e%2e//evil.example",
    "/%2E%2E//evil.example",
    "/.//evil.example",
    "/a/.%2e//evil.example",
    "/\\evil.example",
    "/users\\..\\..\\/evil.example",
    "/x/..\\/evil.example",
    "/\t/evil.example",
    "/\n/evil.example",
    "/\r/evil.example",
    "/%2F%2Fevil.example",
    "/%2f/evil.example",
    "/%5Cevil.example",
    "/%5C%5Cevil.example",
    "/users/%2e%2e%2F%2Fevil.example",
    "/%E0%A4%A",
  ])("refuses the open redirect %j", (value) => {
    const result = localRedirect(value);
    expect(result).toBe("/");
    // Belt and braces: whatever comes back must stay on the origin it is resolved against.
    expect(new URL(result, "https://auth.example").origin).toBe("https://auth.example");
  });

  it("still allows dot segments that stay local, normalized", () => {
    expect(localRedirect("/users/../access/roles")).toBe("/access/roles");
  });

  it("builds a link that survives the round trip", () => {
    const url = new URL(devLoginHref("staff", "/users?socio=yes&page=2"), "http://localhost");
    expect(url.pathname).toBe("/api/dev/login");
    expect(url.searchParams.get("as")).toBe("staff");
    expect(localRedirect(url.searchParams.get("redirect"))).toBe("/users?socio=yes&page=2");
  });
});
