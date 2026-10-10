/**
 * Signs a test person in through Better Auth's own endpoint pipeline, so every plugin hook runs
 * as it does for a real sign-in. That matters for OpenID Connect: the OAuth provider verifies the
 * signed `oauth_query` before the endpoint, and once the endpoint sets a session cookie it resumes
 * the authorization itself, dropping the `prompt=login` and `max_age` the fresh session has just
 * satisfied. Replaying the authorize URL instead would send the person back to the login page.
 *
 * Development only, like the rest of `src/dev/`. The endpoint is never mounted on the auth router:
 * it exists only in the API object built here, in this process.
 */
import { APIError, createAuthEndpoint, getEndpoints } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { z } from "zod";

type AuthContext = Awaited<Parameters<typeof getEndpoints>[0]>;

/** Any Better Auth instance. Its context is typed by its own options, which TypeScript will not
 * widen to the base `AuthContext` that `getEndpoints` takes, although every instance is one. */
type AuthInstance = { $context: Promise<object> };

const devSignInEndpoint = createAuthEndpoint(
  "/dev/sign-in",
  {
    method: "POST",
    // `oauth_query` is the name the OAuth provider's hooks look for.
    body: z.object({ userId: z.string().min(1), oauth_query: z.string().optional() }),
    metadata: { SERVER_ONLY: true },
  },
  async (ctx) => {
    const user = await ctx.context.internalAdapter.findUserById(ctx.body.userId);
    if (!user) throw new APIError("NOT_FOUND", { message: "Unknown user." });
    const session = await ctx.context.internalAdapter.createSession(user.id);
    await setSessionCookie(ctx, { session, user });
    return ctx.json({ redirect: false });
  },
);

export type DevSignInResult =
  | {
      ok: true;
      /** Where the OAuth provider resumes the authorization, when one was in progress. */
      resume?: string;
      cookies: string[];
    }
  | { ok: false; status: number; error: string };

/**
 * Creates a session for `userId`. With `oauthQuery`, the signed query of the login page an
 * application sent the person to, it also returns where the provider continues: usually
 * `/consent`, or the application itself when consent is already on record.
 */
export async function devSignIn(
  auth: AuthInstance,
  input: { userId: string; oauthQuery?: string | null; userAgent?: string | null },
): Promise<DevSignInResult> {
  const context = auth.$context as Promise<AuthContext>;
  const { api } = getEndpoints(context, {
    plugins: [{ id: "dev-sign-in", endpoints: { devSignIn: devSignInEndpoint } }],
  });
  // A JSON request, not a navigation, so the provider answers with where to go instead of
  // redirecting; the caller turns that into the browser's redirect.
  const headers = new Headers({ accept: "application/json", "content-type": "application/json" });
  if (input.userAgent) headers.set("user-agent", input.userAgent);
  const body = {
    userId: input.userId,
    ...(input.oauthQuery ? { oauth_query: input.oauthQuery } : {}),
  };
  const { baseURL } = await context;
  let response: Response;
  try {
    response = await api.devSignIn({
      body,
      headers,
      request: new Request(`${baseURL}/dev/sign-in`, { method: "POST", headers }),
      asResponse: true,
    });
  } catch (error) {
    // Hooks that run before the endpoint, such as the provider's signature check, throw.
    if (error instanceof APIError)
      return { ok: false, status: error.statusCode, error: describe(error.body) };
    throw error;
  }
  const result = (await response.json().catch(() => null)) as {
    redirect?: boolean;
    url?: string;
  } | null;
  if (!response.ok) return { ok: false, status: response.status, error: describe(result) };
  return {
    ok: true,
    cookies: response.headers.getSetCookie(),
    ...(result?.redirect && result.url ? { resume: result.url } : {}),
  };
}

function describe(body: unknown) {
  const { error, error_description, message } = (body ?? {}) as Record<string, unknown>;
  return [error, error_description ?? message].filter(Boolean).join(": ") || "Dev sign-in failed.";
}
