import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { describe, expect, it } from "vite-plus/test";
import { unusedAccountPaths } from "./account-endpoints";

const baseURL = "https://auth.polinetwork.test";
const getPaths = new Set(["/account-info", "/delete-user/callback", "/verify-email"]);

async function signedIn(disabledPaths: string[]) {
  const auth = betterAuth({
    baseURL,
    secret: "account-endpoints-test-secret-at-least-32-characters",
    database: memoryAdapter({ user: [], session: [], account: [], verification: [] }),
    emailAndPassword: { enabled: true },
    disabledPaths,
  });
  // A server-side call to a closed path still works.
  const signUp = await auth.api.signUpEmail({
    body: { email: "member@example.test", name: "Member", password: "test-password-at-least-16" },
    asResponse: true,
  });
  expect(signUp.status).toBe(200);
  const headers = new Headers({
    cookie: signUp.headers
      .getSetCookie()
      .map((value) => value.split(";")[0])
      .join("; "),
    origin: baseURL,
    "content-type": "application/json",
  });
  const request = (path: string, body?: unknown) =>
    auth.handler(
      new Request(`${baseURL}/api/auth${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    );
  return { auth, headers, request };
}

describe("unused account endpoints", () => {
  it("are refused over HTTP", async () => {
    const { request } = await signedIn(unusedAccountPaths);
    for (const path of unusedAccountPaths) {
      const response = await request(path, getPaths.has(path) ? undefined : {});
      expect(response.status, path).toBe(404);
    }
    expect((await request("/get-session")).status).toBe(200);
  });

  it("do not let a signed-in person rename themselves", async () => {
    const open = await signedIn([]);
    expect((await open.request("/update-user", { name: "Someone Else" })).status).toBe(200);

    const { auth, headers, request } = await signedIn(unusedAccountPaths);
    const response = await request("/update-user", {
      name: "Someone Else",
      image: "https://example.test/x.png",
    });
    expect(response.status).toBe(404);
    const session = await auth.api.getSession({ headers });
    expect(session?.user.name).toBe("Member");
    expect(session?.user.image ?? null).toBeNull();
  });
});
