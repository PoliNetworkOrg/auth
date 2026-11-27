import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { validate } from "@/lib/validate";
import { resolveClientReturn } from "./app-return";
import { auth } from "./index";
import { actionMiddleware } from "./middleware";
import { clientErrorFor, clientErrorUrl, signedQueryExpiry } from "./sign-in-errors";
import { readAppContext, verifySignedQueryIgnoringExpiry } from "./sign-in-return";

/**
 * The application a failure on `/error` happened in, from the page's signed `app` token: what to
 * call it, how to restart the same sign-in, and how to go back to it with an OAuth error. Null
 * without a valid token, and the page then offers only the person's account.
 */
export const getErrorApp = createServerFn({ method: "GET" })
  .middleware([actionMiddleware])
  .validator(
    validate(
      z.object({
        error: z.string().max(200),
        app: z.string().max(8192).optional().catch(undefined),
      }),
    ),
  )
  .handler(async ({ data }) => {
    if (!data.app) return null;
    const context = await auth.$context;
    const request = await readAppContext(data.app, context.secret);
    const client = request ? await resolveClientReturn(request) : null;
    if (!request || !client) return null;
    return {
      ...client.app,
      // The original authorization request: Auth checks it again and shows a fresh sign-in.
      retryHref: `/api/auth/oauth2/authorize?${request}`,
      backHref: clientErrorUrl(client.target, clientErrorFor(data.error), context.baseURL),
    };
  });

/**
 * Where an expired sign-in page sends the person: back to the application with
 * `login_required`, so it can start a fresh sign-in (OIDC Core §3.1.2.6). Null when the page's
 * query isn't one Auth signed, or its application can't be reached any more.
 */
export const returnFromExpiredSignIn = createServerFn({ method: "POST" })
  .middleware([actionMiddleware])
  .validator(validate(z.object({ search: z.string().max(8192) })))
  .handler(async ({ data }) => {
    const context = await auth.$context;
    const request = await verifySignedQueryIgnoringExpiry(data.search, context.secret);
    if (!request) return { status: "unknown" as const };
    // The browser's clock decided the page expired; the server's decides. A clock running fast
    // would otherwise send people back to the application in a loop.
    const expiresAt = signedQueryExpiry(data.search);
    if (expiresAt !== null && expiresAt > Date.now())
      return { status: "active" as const, remainingMs: expiresAt - Date.now() };
    const client = await resolveClientReturn(request);
    if (!client) return { status: "unknown" as const };
    return {
      status: "expired" as const,
      app: client.app.name,
      href: clientErrorUrl(client.target, clientErrorFor("login_required"), context.baseURL),
    };
  });
