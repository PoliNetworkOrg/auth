/**
 * Signs the browser in as a fixed test persona, for local development. Reached only through
 * `src/routes/api/dev/login.ts`, which imports this module behind `import.meta.env.DEV`
 * so production builds never contain it. On top of that it only answers when `.env.local`
 * sets `DEV_LOGIN=1`, which `scripts/security-config.mjs` refuses outside localhost.
 */
import { makeSignature } from "better-auth/crypto";
import { auth } from "../auth";
import { findPersona, listPersonas, saveDevUser } from "./personas";
import { DEV_LOGIN_KIND, localRedirect, type DevLoginListing } from "./shared";

const noStore = { "Cache-Control": "no-store" };

function serializeCookie(
  name: string,
  value: string,
  attributes: { path?: string; secure?: boolean; sameSite?: string; maxAge?: number },
) {
  const sameSite = attributes.sameSite ?? "lax";
  return [
    `${name}=${encodeURIComponent(value)}`,
    `Path=${attributes.path ?? "/"}`,
    "HttpOnly",
    `SameSite=${sameSite[0]!.toUpperCase()}${sameSite.slice(1).toLowerCase()}`,
    ...(attributes.secure ? ["Secure"] : []),
    ...(attributes.maxAge ? [`Max-Age=${attributes.maxAge}`] : []),
  ].join("; ");
}

/**
 * `GET ?as=<persona>&redirect=<path>` signs in and redirects; without `as` it lists the
 * personas. A real session is created through Better Auth, so everything downstream (the
 * session hook, RBAC, API guards) behaves exactly as after a normal sign-in.
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

  await saveDevUser(persona);
  const context = await auth.$context;
  const session = await context.internalAdapter.createSession(persona.id);
  const cookie = context.authCookies.sessionToken;
  const signed = `${session.token}.${await makeSignature(session.token, context.secret)}`;
  return new Response(null, {
    status: 303,
    headers: {
      ...noStore,
      Location: localRedirect(url.searchParams.get("redirect")),
      "Set-Cookie": serializeCookie(cookie.name, signed, {
        ...cookie.attributes,
        maxAge: context.sessionConfig.expiresIn,
      }),
    },
  });
}
