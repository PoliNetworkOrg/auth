import { createServerFn } from "@tanstack/react-start";
import { deleteCookie, getCookie, getRequest, setCookie } from "@tanstack/react-start/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/index";
import { account, oauthClient } from "@/db/schema";
import { env } from "@/env";
import { validate } from "@/lib/validate";
import { linkAttemptCookie } from "./cookies";
import { auth } from "./index";
import {
  LINK_ATTEMPT_MAX_AGE_SECONDS,
  LINK_METHODS,
  linkAttemptValue,
  linkReturn,
  type LinkMethod,
} from "./link-request";
import { actionMiddleware, sessionMiddleware } from "./middleware";
import { OIDC_CLIENT_REFERENCE } from "./oidc-clients";

/**
 * An enabled application of the shared pool. Clients that agents registered for themselves are
 * left out: anyone can register one, so their redirect URIs vouch for nothing.
 */
async function readPoolClient(clientId: string) {
  const [client] = await db
    .select({
      name: oauthClient.name,
      icon: oauthClient.icon,
      iconDark: oauthClient.iconDark,
      redirectUris: oauthClient.redirectUris,
      disabled: oauthClient.disabled,
    })
    .from(oauthClient)
    .where(
      and(eq(oauthClient.clientId, clientId), eq(oauthClient.referenceId, OIDC_CLIENT_REFERENCE)),
    );
  return client && !client.disabled ? client : null;
}

const linkRequestInput = z.object({
  method: z.enum(Object.keys(LINK_METHODS) as [LinkMethod, ...LinkMethod[]]),
  // Out of bounds, they're ignored like any other untrusted return: the page still works.
  clientId: z.string().min(1).max(255).optional().catch(undefined),
  returnTo: z.string().max(2048).optional().catch(undefined),
});

/** The application and its trusted return address for a request, or neither. */
async function resolveReturn(data: z.infer<typeof linkRequestInput>) {
  const client = data.clientId ? await readPoolClient(data.clientId) : null;
  return linkReturn(client, data.returnTo);
}

function attemptCookie() {
  const secure = new URL(env.BETTER_AUTH_URL).protocol === "https:";
  return {
    name: linkAttemptCookie(secure),
    options: { httpOnly: true, secure, sameSite: "lax", path: "/" } as const,
  };
}

/**
 * What `/link` needs to know about a request: the application to go back to, and only when
 * `return_to` is one of its own addresses (otherwise the page names no application and stays
 * on PoliNetwork Auth), and whether the signed-in person, if any, already has the method linked.
 *
 * On the way back from the provider (`returning`), `attempted` says whether this browser started
 * this very link, for this method and return address, in the last few minutes; the attempt is
 * used up. Only then does the page go back to the application by itself.
 */
export const getLinkRequest = createServerFn({ method: "GET" })
  .middleware([actionMiddleware])
  .validator(validate(linkRequestInput.extend({ returning: z.boolean().optional() })))
  .handler(async ({ data }) => {
    const [{ app, returnTo }, session] = await Promise.all([
      resolveReturn(data),
      auth.api.getSession({ headers: getRequest().headers }),
    ]);
    let linked: boolean | null = null;
    if (session) {
      const [existing] = await db
        .select({ id: account.id })
        .from(account)
        .where(and(eq(account.userId, session.user.id), eq(account.providerId, data.method)))
        .limit(1);
      linked = !!existing;
    }
    let attempted = false;
    if (data.returning) {
      const cookie = attemptCookie();
      attempted = !!returnTo && getCookie(cookie.name) === linkAttemptValue(data.method, returnTo);
      deleteCookie(cookie.name, cookie.options);
    }
    return { app, returnTo, linked, attempted };
  });

/**
 * Records that the signed-in person is about to leave for the provider from this link, so the
 * page may go back to the application by itself when they return. Nothing is recorded without
 * a trusted return address.
 */
export const startLinkAttempt = createServerFn({ method: "POST" })
  .middleware([sessionMiddleware])
  .validator(validate(linkRequestInput))
  .handler(async ({ data }) => {
    const { returnTo } = await resolveReturn(data);
    if (!returnTo) return { recorded: false };
    const cookie = attemptCookie();
    setCookie(cookie.name, linkAttemptValue(data.method, returnTo), {
      ...cookie.options,
      maxAge: LINK_ATTEMPT_MAX_AGE_SECONDS,
    });
    return { recorded: true };
  });

export type LinkRequestDetails = Omit<Awaited<ReturnType<typeof getLinkRequest>>, "attempted">;
