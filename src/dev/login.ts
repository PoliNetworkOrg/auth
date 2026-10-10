/**
 * Signs the browser in as a fixed test persona, for local development. Reached only through
 * `src/routes/api/dev/login.ts`, which imports this module behind `import.meta.env.DEV`
 * so production builds never contain it. On top of that it only answers when `.env.local`
 * sets `DEV_LOGIN=1`, which `scripts/security-config.mjs` refuses outside localhost.
 */
import { auth } from "../auth";
import { DevFixtureConflict, findPersona, listPersonas, saveDevUser } from "./personas";
import { DEV_LOGIN_KIND, localRedirect, type DevLoginListing } from "./shared";
import { devSignIn } from "./sign-in";

const noStore = { "Cache-Control": "no-store" };

/**
 * `GET ?as=<persona>&redirect=<path>` signs in and redirects; without `as` it lists the
 * personas. A real session is created through Better Auth, so everything downstream (the
 * session hook, RBAC, API guards) behaves exactly as after a normal sign-in. When an
 * application sent the person to the login page, `oauth_query` carries that page's signed
 * query and the sign-in resumes the authorization (see `./sign-in.ts`).
 */
export async function handleDevLogin(request: Request): Promise<Response> {
  if (process.env.DEV_LOGIN !== "1")
    return new Response("Not found", { status: 404, headers: noStore });

  const url = new URL(request.url);
  const key = url.searchParams.get("as");
  if (!key) {
    const listing: DevLoginListing = { kind: DEV_LOGIN_KIND, personas: listPersonas() };
    return Response.json(listing, { headers: noStore });
  }

  const persona = findPersona(key);
  if (!persona)
    return Response.json(
      { error: `Unknown persona "${key}".`, personas: listPersonas().map((entry) => entry.key) },
      { status: 400, headers: noStore },
    );

  try {
    await saveDevUser(persona);
  } catch (error) {
    if (!(error instanceof DevFixtureConflict)) throw error;
    return Response.json({ error: error.message }, { status: 409, headers: noStore });
  }
  const result = await devSignIn(auth, {
    userId: persona.id,
    oauthQuery: url.searchParams.get("oauth_query"),
    userAgent: request.headers.get("user-agent"),
  });
  if (!result.ok)
    return Response.json(
      { error: `Could not sign in as "${key}": ${result.error}` },
      { status: result.status, headers: noStore },
    );
  // With an authorization in progress the OAuth provider decides where it continues; otherwise
  // only a local path is followed.
  const headers = new Headers({
    ...noStore,
    Location: result.resume ?? localRedirect(url.searchParams.get("redirect")),
  });
  for (const cookie of result.cookies) headers.append("Set-Cookie", cookie);
  return new Response(null, { status: 303, headers });
}
