import { describe, expect, it } from "vite-plus/test";
import { readLogoutStep, redirectLogoutPage } from "./logout-page";

function pluginPage(body: string, cookies: string[] = []) {
  const headers = new Headers({ "content-type": "text/html; charset=utf-8" });
  for (const cookie of cookies) headers.append("set-cookie", cookie);
  return new Response(`<!doctype html><html><body>${body}</body></html>`, { headers });
}

describe("readLogoutStep", () => {
  it("recognises each page the plugin renders", () => {
    expect(readLogoutStep('<form method="post" data-oidc-logout-confirmation>')).toEqual({
      status: "confirm",
    });
    expect(readLogoutStep('<p data-oidc-logout-state="logged-out">Logged out.</p>')).toEqual({
      status: "done",
    });
    expect(
      readLogoutStep(
        '<p data-oidc-logout-state="logged-out">Logged out. The requested post-logout redirect was not registered.</p>',
      ),
    ).toEqual({ status: "done", redirect: "unregistered" });
    expect(
      readLogoutStep(
        '<p data-oidc-logout-state="error">The logout confirmation is invalid or expired</p>',
      ),
    ).toEqual({ status: "error", reason: "expired" });
    expect(readLogoutStep('<p data-oidc-logout-state="error">Something new</p>')).toEqual({
      status: "error",
      reason: "unknown",
    });
    expect(readLogoutStep("<p>Other</p>")).toBeNull();
  });
});

describe("redirectLogoutPage", () => {
  it("redirects to /logout and keeps every cookie", async () => {
    const response = await redirectLogoutPage(
      pluginPage("<form data-oidc-logout-confirmation></form>", ["a=1; Path=/", "b=2; Path=/x"]),
    );
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/logout");
    expect(response.headers.getSetCookie()).toEqual(["a=1; Path=/", "b=2; Path=/x"]);
  });

  it("carries the step in the query", async () => {
    const response = await redirectLogoutPage(
      pluginPage('<p data-oidc-logout-state="error">The id_token_hint is invalid</p>'),
    );
    expect(response.headers.get("location")).toBe("/logout?status=error&reason=token");
  });

  it("leaves other responses alone", async () => {
    const json = Response.json({ ok: true });
    expect(await redirectLogoutPage(json)).toBe(json);
  });
});
