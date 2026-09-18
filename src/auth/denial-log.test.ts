import { expect, it, vi } from "vite-plus/test";
import { logAuthorizationDenial } from "./denial-log";
it("logs a denial using only actor, endpoint and required permission", () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  try {
    logAuthorizationDenial("user-id", "/api/rbac/role-save", ["idp:roles:write"]);
    expect(JSON.parse(warn.mock.calls[0][0])).toEqual({
      event: "authorization_denied",
      actorId: "user-id",
      endpoint: "/api/rbac/role-save",
      required: ["idp:roles:write"],
    });
  } finally {
    warn.mockRestore();
  }
});
