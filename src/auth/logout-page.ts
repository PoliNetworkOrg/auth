/**
 * The OAuth provider answers browser logout requests with bare HTML pages it has no option to
 * restyle. These helpers recognise those pages by their data attributes and send the browser to
 * `/logout`, which shows the same step with the app's design. Every cookie the plugin set,
 * including the signed confirmation state, travels with the redirect.
 */

export type LogoutStep =
  | { status: "confirm" }
  | { status: "done"; redirect?: "unregistered" }
  | { status: "error"; reason: LogoutErrorReason };

export type LogoutErrorReason = "expired" | "client" | "token" | "unknown";

/** The form on `/logout` posts here; the plugin reads the confirmation from its signed cookie. */
export const LOGOUT_CONFIRM_PATH = "/api/auth/oauth2/end-session/confirm";

const errorReasons: [string, LogoutErrorReason][] = [
  ["confirmation is invalid or expired", "expired"],
  ["No active session", "expired"],
  ["logout client", "client"],
  ["client is not allowed", "client"],
  ["id_token_hint is invalid", "token"],
];

export function readLogoutStep(html: string): LogoutStep | null {
  if (html.includes("data-oidc-logout-confirmation")) return { status: "confirm" };
  if (html.includes('data-oidc-logout-state="logged-out"'))
    return html.includes("not registered")
      ? { status: "done", redirect: "unregistered" }
      : { status: "done" };
  if (html.includes('data-oidc-logout-state="error"'))
    return {
      status: "error",
      reason: errorReasons.find(([text]) => html.includes(text))?.[1] ?? "unknown",
    };
  return null;
}

export async function redirectLogoutPage(response: Response): Promise<Response> {
  if (!response.headers.get("content-type")?.startsWith("text/html")) return response;
  const step = readLogoutStep(await response.clone().text());
  if (!step) return response;

  const search = new URLSearchParams(step);
  if (step.status === "confirm") search.delete("status");
  const headers = new Headers({ "cache-control": "no-store" });
  for (const cookie of response.headers.getSetCookie()) headers.append("set-cookie", cookie);
  headers.set("location", search.size ? `/logout?${search}` : "/logout");
  return new Response(null, { status: 303, headers });
}
