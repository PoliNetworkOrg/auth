import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/index";
import { account, oauthClient } from "@/db/schema";
import { validate } from "@/lib/validate";
import { auth } from "./index";
import { LINK_METHODS, linkReturn, type LinkMethod } from "./link-request";
import { actionMiddleware } from "./middleware";
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

/**
 * What `/link` needs to know about a request: the application to go back to, and only when
 * `return_to` is one of its own addresses (otherwise the page names no application and stays
 * on PoliNetwork Auth), and whether the signed-in person, if any, already has the method linked.
 */
export const getLinkRequest = createServerFn({ method: "GET" })
  .middleware([actionMiddleware])
  .validator(
    validate(
      z.object({
        method: z.enum(Object.keys(LINK_METHODS) as [LinkMethod, ...LinkMethod[]]),
        // Out of bounds, they're ignored like any other untrusted return: the page still works.
        clientId: z.string().min(1).max(255).optional().catch(undefined),
        returnTo: z.string().max(2048).optional().catch(undefined),
      }),
    ),
  )
  .handler(async ({ data }) => {
    const [client, session] = await Promise.all([
      data.clientId ? readPoolClient(data.clientId) : null,
      auth.api.getSession({ headers: getRequest().headers }),
    ]);
    const { app, returnTo } = linkReturn(client, data.returnTo);
    let linked: boolean | null = null;
    if (session) {
      const [existing] = await db
        .select({ id: account.id })
        .from(account)
        .where(and(eq(account.userId, session.user.id), eq(account.providerId, data.method)))
        .limit(1);
      linked = !!existing;
    }
    return { app, returnTo, linked };
  });

export type LinkRequestDetails = Awaited<ReturnType<typeof getLinkRequest>>;
