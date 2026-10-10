import { beforeEach, expect, it, vi } from "vite-plus/test";
import { z } from "zod";
const mocks = vi.hoisted(() => ({ session: vi.fn(), permissions: vi.fn() }));
vi.mock("./index", () => ({ auth: { api: { getSession: mocks.session } } }));
vi.mock("./idp-access", () => ({ idpPermissions: mocks.permissions }));
vi.mock("../env", () => ({ env: { BETTER_AUTH_URL: "https://auth.example" } }));
import { ActionError } from "@/lib/action-error";
import { validate } from "@/lib/validate";
import { AccountError } from "./accounts";
import { authorize, requireSession, toActionError } from "./guard";
import { RbacError } from "./rbac-store";

const headers = () => new Headers({ cookie: "session=never-log" });
beforeEach(() => {
  mocks.session.mockReset().mockResolvedValue({ user: { id: "actor" } });
  mocks.permissions.mockReset().mockResolvedValue(["idp:roles:write"]);
});

it("admits a session holding one of the required permissions", async () => {
  await expect(authorize(headers(), ["idp:roles:write"], "saveRoleFn")).resolves.toEqual({
    userId: "actor",
    permissions: ["idp:roles:write"],
  });
});
it("denies missing sessions", async () => {
  mocks.session.mockResolvedValue(null);
  await expect(authorize(headers(), ["idp:roles:write"], "saveRoleFn")).rejects.toMatchObject({
    status: 401,
  });
  await expect(requireSession(headers())).rejects.toMatchObject({ status: 401 });
});
it("denies an empty required set or an unknown permission", async () => {
  await expect(authorize(headers(), [], "saveRoleFn")).rejects.toMatchObject({ status: 403 });
  await expect(
    authorize(headers(), ["idp:roles:write:extra" as never], "saveRoleFn"),
  ).rejects.toMatchObject({ status: 403 });
});
it("denies a failed authorization lookup without logging secrets", async () => {
  mocks.permissions.mockRejectedValue(new Error("private-provider-token"));
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  try {
    await expect(authorize(headers(), ["idp:roles:write"], "saveRoleFn")).rejects.toMatchObject({
      status: 503,
    });
    const log = JSON.stringify(warn.mock.calls);
    expect(log).not.toMatch(/never-log|private-provider-token/);
    expect(log).toContain("authorization_denied");
    expect(log).toContain("saveRoleFn");
  } finally {
    warn.mockRestore();
  }
});

it("passes on refusals the domain code explains, with their status and fields", () => {
  expect(toActionError(new RbacError(409, "Taken.", { key: "Taken." }))).toMatchObject({
    status: 409,
    message: "Taken.",
    fields: { key: "Taken." },
  });
  expect(toActionError(new AccountError(400, "Keep one."))).toMatchObject({ status: 400 });
  const refusal = new ActionError(403, "No.");
  expect(toActionError(refusal)).toBe(refusal);
});
it("never sends the browser the message of an unexpected error", () => {
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    const mapped = toActionError(new Error('relation "secret_table" does not exist'));
    expect(mapped).toBeInstanceOf(ActionError);
    expect(mapped).toMatchObject({ status: 500 });
    expect((mapped as ActionError).message).not.toContain("secret_table");
  } finally {
    error.mockRestore();
  }
});
it("refuses malformed input with a plain 400", () => {
  const check = validate(z.object({ id: z.string().min(1) }));
  expect(check({ id: "a" })).toEqual({ id: "a" });
  expect(() => check({ id: "" })).toThrow(ActionError);
  try {
    check({ id: "" });
  } catch (cause) {
    expect(cause).toMatchObject({ status: 400, message: "Invalid request." });
  }
});
