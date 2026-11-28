import { getOAuthState, isAPIError } from "better-auth/api";
import { env } from "../env";
import { resolveClientReturn } from "./app-return";
import { readRefusal } from "./refusals";
import { authorizationRequestOf, isErrorPageUrl, routeCallback } from "./sign-in-errors";
import { signAppContext } from "./sign-in-return";

/** Auth's own error page, where Better Auth and the provider plugin send failures. */
export const ERROR_PAGE_URL = new URL("/error", env.BETTER_AUTH_URL).href;

type CallbackContext = {
  params?: Record<string, string | undefined>;
  context: { returned?: unknown; baseURL: string; secret: string };
  redirect: (url: string) => Error;
};

function locationOf(response: { headers?: unknown }) {
  const { headers } = response;
  if (headers instanceof Headers) return headers.get("location");
  if (headers && typeof headers === "object" && "location" in headers) {
    const location = (headers as Record<string, unknown>).location;
    return typeof location === "string" ? location : null;
  }
  return null;
}

/**
 * Runs after every provider callback (`/callback/:id`). When it ends on the error page:
 * - inside an application's sign-in, a cancel goes straight back to the application with
 *   `access_denied`, as OAuth expects; anything else goes to the error page with a signed
 *   context, so it can offer **Try again** and **Back to {application}**;
 * - a refused account gets its own code instead of Better Auth's `unable_to_get_user_info`.
 *
 * Errors bound for another page, like the error callback of `/link`, are left alone.
 */
export async function routeCallbackError(ctx: CallbackContext) {
  const returned = ctx.context.returned;
  if (!isAPIError(returned) || returned.statusCode !== 302) return;
  const location = locationOf(returned);
  // Successes and flows with their own error callback: nothing to look up.
  if (!location || !isErrorPageUrl(location, ERROR_PAGE_URL)) return;

  // The authorization request a sign-in started from, kept in the encrypted OAuth state when
  // the sign-in began. It was verified then, and the state can't be forged.
  const state = await getOAuthState();
  const query = state && !state.link ? state.serverContext?.query : undefined;
  const request =
    typeof query === "string" ? authorizationRequestOf(new URLSearchParams(query)) : null;
  const client = request ? await resolveClientReturn(request) : null;

  const route = routeCallback({
    location,
    errorPage: ERROR_PAGE_URL,
    refusal: await readRefusal(),
    provider: ctx.params?.id,
    client: client?.target ?? null,
    issuer: ctx.context.baseURL,
  });
  if (!route) return;
  if (route.to === "client") throw ctx.redirect(route.url);
  const page = new URL(ERROR_PAGE_URL);
  page.searchParams.set("error", route.code);
  if (route.provider) page.searchParams.set("provider", route.provider);
  if (route.withApp && request)
    page.searchParams.set("app", await signAppContext(request, ctx.context.secret));
  throw ctx.redirect(page.href);
}
