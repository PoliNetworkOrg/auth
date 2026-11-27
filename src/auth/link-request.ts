// Shared by the server and the browser: keep this file free of server-only imports.

/**
 * `/link` lets a registered application send a signed-in person to link one login method,
 * then takes them back: `/link?method=telegram&client_id=…&return_to=…`. These are its rules,
 * kept apart from the page so they can be tested on their own.
 */

/** The login methods an application may ask for, with how the page names them. */
export const LINK_METHODS = {
  telegram: { name: "Telegram", mark: "telegram" },
  "pn-entra": { name: "PoliNetwork APS", mark: "polinetwork" },
  google: { name: "Google", mark: "google" },
} as const;

export type LinkMethod = keyof typeof LINK_METHODS;

export function isLinkMethod(value: unknown): value is LinkMethod {
  return typeof value === "string" && Object.hasOwn(LINK_METHODS, value);
}

/**
 * What an application can get back in `link_error`:
 * - `cancelled`: the person chose **Not now**, or cancelled at the provider;
 * - `account_in_use`: that login already belongs to another PoliNetwork Auth user;
 * - `unavailable`: this deployment can't link that method;
 * - `failed`: anything else.
 */
export const LINK_ERRORS = ["cancelled", "account_in_use", "unavailable", "failed"] as const;

export type LinkError = (typeof LINK_ERRORS)[number];

export type LinkOutcome = { linked: LinkMethod } | { error: LinkError };

/**
 * Codes that mean the person stopped at the provider: OAuth's own `access_denied` (RFC 6749
 * §4.1.2.1) and the names some providers use instead. Not OIDC's `consent_required`: that one
 * means the provider couldn't ask, not that the person said no.
 */
const CANCEL_CODES = new Set(["access_denied", "user_cancelled", "cancelled"]);

/** The `link_error` for the `error` Better Auth appends to the link's error callback. */
export function linkErrorFromCallback(code: string | undefined): LinkError {
  if (code && CANCEL_CODES.has(code)) return "cancelled";
  if (code === "account_already_linked_to_different_user") return "account_in_use";
  return "failed";
}

/**
 * The outcome of the provider round-trip: `result` is what the link's own callback says,
 * `error` what Better Auth appended to the error callback, and `linked` whether the method is
 * now linked to the signed-in person. Anyone can write `result=linked` in an address, so only
 * `linked` counts as success.
 */
export function callbackOutcome(
  method: LinkMethod,
  result: "linked" | "failed",
  linked: boolean | null,
  error?: string,
): LinkOutcome {
  if (result === "linked") return linked ? { linked: method } : { error: "failed" };
  return { error: linkErrorFromCallback(error) };
}

/** An absolute http(s) URL with no credentials in it, or null. */
function parseWebUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.username || url.password) return null;
  return url;
}

/**
 * `returnTo`, when it can be trusted for an application whose redirect URIs are
 * `redirectUris`: an absolute http(s) URL on the same origin (scheme, host and port) as one of
 * them. Anything else is null, and the person stays on PoliNetwork Auth: never an open redirect.
 */
export function trustedReturnTo(returnTo: string | undefined, redirectUris: readonly string[]) {
  if (!returnTo) return null;
  const url = parseWebUrl(returnTo);
  if (!url) return null;
  const origins = new Set(
    redirectUris.flatMap((uri) => {
      const registered = parseWebUrl(uri);
      return registered ? [registered.origin] : [];
    }),
  );
  return origins.has(url.origin) ? url.href : null;
}

export type LinkApp = { name: string; logo: string | null; logoDark: string | null };

/** A registered application, as far as `/link` needs it. */
export type LinkClient = {
  name: string | null;
  icon: string | null;
  iconDark: string | null;
  redirectUris: readonly string[];
};

/**
 * The application to name and the address to go back to: both only when `client` exists and
 * `returnTo` is one of its own addresses, otherwise neither. Then the page names no application
 * and stays on PoliNetwork Auth, so a link can't claim to come from an application it doesn't
 * return to.
 */
export function linkReturn(client: LinkClient | null, returnTo: string | undefined) {
  const trusted = client ? trustedReturnTo(returnTo, client.redirectUris) : null;
  if (!client || !trusted) return { app: null, returnTo: null };
  const app: LinkApp = {
    name: client.name ?? "The application",
    logo: client.icon ?? null,
    logoDark: client.iconDark ?? null,
  };
  return { app, returnTo: trusted };
}

/**
 * `returnTo` with the outcome added as `linked` or `link_error`, replacing either if present.
 * The rest of the query is kept as written: re-encoding it could change what the application
 * reads (a `%20` turned into `+`, say).
 */
export function withLinkOutcome(returnTo: string, outcome: LinkOutcome) {
  const url = new URL(returnTo);
  const kept = url.search
    .slice(1)
    .split("&")
    .filter((pair) => {
      if (!pair) return false;
      const [name] = new URLSearchParams(pair).keys();
      return name !== "linked" && name !== "link_error";
    });
  const added = "linked" in outcome ? `linked=${outcome.linked}` : `link_error=${outcome.error}`;
  url.search = [...kept, added].join("&");
  return url.href;
}

export type LinkRequest = {
  method: LinkMethod;
  clientId?: string;
  returnTo?: string;
};

/**
 * The `/link` page for `request`, as a path on PoliNetwork Auth. With `result`, it is where the
 * provider round-trip comes back to: Better Auth only redirects to its own origin, so the page
 * checks the outcome and the return address again before leaving for the application.
 */
export function linkPagePath(request: LinkRequest, result?: "linked" | "failed") {
  const search = new URLSearchParams({ method: request.method });
  if (request.clientId) search.set("client_id", request.clientId);
  if (request.returnTo) search.set("return_to", request.returnTo);
  if (result) search.set("result", result);
  return `/link?${search}`;
}
