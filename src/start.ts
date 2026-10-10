import {
  createCsrfMiddleware,
  createMiddleware,
  createServerOnlyFn,
  createStart,
} from "@tanstack/react-start";
import { getResponseStatus } from "@tanstack/react-start/server";
import { actionErrorAdapter } from "@/lib/action-error";
import { env } from "@/env";

/** The public origin, not the one the request reached this process with behind the proxy. */
const trustedOrigin = createServerOnlyFn(() => new URL(env.BETTER_AUTH_URL).origin);

/**
 * Server functions are same-origin RPC endpoints, so every call must come from this app's own
 * pages: the browser's Sec-Fetch-Site, or failing that the Origin, has to say so. Server
 * routes are not covered; the few left serve other applications and check their own callers.
 */
const csrfMiddleware = createCsrfMiddleware({
  filter: (ctx) => ctx.handlerType === "serverFn",
  origin: (value) => value === trustedOrigin(),
});

/**
 * The router answers a page whose guard or loader refused it with 500. The refusal records
 * its real status (401 for the sign-in page, 403 for a missing permission, 404 for a record
 * that does not exist), and this applies it.
 */
const refusalStatusMiddleware = createMiddleware().server(async ({ next, handlerType }) => {
  const result = await next();
  const status = getResponseStatus();
  if (handlerType !== "router" || result.response.status !== 500) return result;
  if (status < 400 || status >= 500) return result;
  const { body, headers } = result.response;
  return { ...result, response: new Response(body, { status, headers }) };
});

export const startInstance = createStart(() => ({
  requestMiddleware: [csrfMiddleware, refusalStatusMiddleware],
  serializationAdapters: [actionErrorAdapter],
}));
