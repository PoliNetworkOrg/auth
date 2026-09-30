import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { describe, expect, it } from "vite-plus/test";
import { AUTH_COOKIE_PREFIX } from "./cookies";

// HTTPS, as in production, so cookie names carry the `__Secure-` prefix.
const baseURL = "https://auth.polinetwork.test";
const password = "correct-horse-battery-staple";

function memoryDatabase() {
  return memoryAdapter({ user: [], session: [], account: [], verification: [] });
}

/** Configured like the other PoliNetwork services: default prefix, cookie cache on. */
function siblingService() {
  return betterAuth({
    baseURL,
    secret: "sibling-service-secret-at-least-32-characters",
    database: memoryDatabase(),
    emailAndPassword: { enabled: true },
    session: { cookieCache: { enabled: true, maxAge: 300 } },
  });
}

function identityProvider(cookiePrefix: string | undefined) {
  return betterAuth({
    baseURL,
    secret: "identity-provider-secret-at-least-32-characters",
    database: memoryDatabase(),
    emailAndPassword: { enabled: true },
    session: { cookieCache: { enabled: false } },
    advanced: { cookiePrefix },
  });
}

async function signUpCookies(
  auth: ReturnType<typeof siblingService> | ReturnType<typeof identityProvider>,
  email: string,
) {
  const response = await auth.api.signUpEmail({
    body: { email, password, name: "Test" },
    asResponse: true,
  });
  return response.headers.getSetCookie().map((cookie) => cookie.split(";")[0]!);
}

/** The browser sends the older, domain-wide sibling cookies before ours. */
async function sessionWithSiblingCookies(cookiePrefix: string | undefined) {
  const sibling = await signUpCookies(siblingService(), "sibling@polinetwork.test");
  const auth = identityProvider(cookiePrefix);
  const own = await signUpCookies(auth, "person@polinetwork.test");
  const cookie = [...sibling, ...own].join("; ");
  return auth.api.getSession({ headers: new Headers({ cookie }) });
}

describe("auth cookies", () => {
  it("reproduces the collision when both services use the default prefix", async () => {
    await expect(sessionWithSiblingCookies(undefined)).resolves.toBeNull();
  });

  it("keeps the session when another PoliNetwork service's cookies arrive first", async () => {
    const session = await sessionWithSiblingCookies(AUTH_COOKIE_PREFIX);
    expect(session?.user.email).toBe("person@polinetwork.test");
  });
});
