import { beforeEach, expect, it, vi } from "vite-plus/test";
const mocks = vi.hoisted(() => ({ session: vi.fn(), permissions: vi.fn() }));
vi.mock("./index", () => ({ auth: { api: { getSession: mocks.session } } }));
vi.mock("./idp-access", () => ({ idpPermissions: mocks.permissions }));
vi.mock("../env", () => ({ env: { BETTER_AUTH_URL: "https://auth.example" } }));
import { requireAnyIdpPermission, requireIdpPermission } from "./api-guard";
const request = () =>
  new Request("https://auth.example/api/rbac/role-save?token=never-log", {
    method: "POST",
    headers: { origin: "https://auth.example" },
    body: "secret-body",
  });
beforeEach(() => {
  mocks.session.mockReset().mockResolvedValue({ user: { id: "actor" } });
  mocks.permissions.mockReset().mockResolvedValue(["idp:roles:write"]);
});
it("denies missing sessions", async () => {
  mocks.session.mockResolvedValue(null);
  expect(await requireIdpPermission(request(), "idp:roles:write")).toMatchObject({
    response: { status: 401 },
  });
});
it("denies an empty required set or an unknown permission", async () => {
  expect(await requireAnyIdpPermission(request(), [])).toMatchObject({ response: { status: 403 } });
  expect(await requireIdpPermission(request(), "idp:roles:write:extra" as never)).toMatchObject({
    response: { status: 403 },
  });
});
it("denies a failed authorization lookup without logging secrets", async () => {
  mocks.permissions.mockRejectedValue(new Error("private-provider-token"));
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  try {
    expect(await requireIdpPermission(request(), "idp:roles:write")).toMatchObject({
      response: { status: 503 },
    });
    const log = JSON.stringify(warn.mock.calls);
    expect(log).not.toMatch(/never-log|secret-body|private-provider-token/);
    expect(log).toContain("authorization_denied");
  } finally {
    warn.mockRestore();
  }
});
