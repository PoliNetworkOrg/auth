// Shared by the server and the browser: keep this file free of server-only imports.

/**
 * What a failed sign-in means, and where it should take the person. Better Auth, the OAuth
 * provider plugin and our own providers each report failures as a short code; this module
 * turns that code into copy for `/error`, and into the error an application gets back when
 * the failure happened inside its sign-in (RFC 6749 §4.1.2.1, OIDC Core §3.1.2.6).
 */

/** Codes our providers record when they can't return an account (see `src/auth/providers.ts`). */
export const PROVIDER_ERROR_CODES = {
  /** Refused: a B2B guest of the association's tenant tried PoliNetwork APS. */
  entraGuest: "pn_entra_guest",
  /** Refused: an Entra token from another tenant. */
  entraTenant: "pn_entra_tenant",
  /** Refused: the provider's token lacks what we need to know who this is. */
  missingClaims: "provider_missing_claims",
  /** Not a refusal: the provider or Auth failed (keys unreachable, a bad token, the database). */
  failed: "provider_failed",
} as const;

export type ErrorKind =
  /** The person stopped at the provider. Inside an application, it goes straight back to it. */
  | "cancelled"
  /** The provider worked, but Auth won't accept this account. Auth explains first. */
  | "refused"
  /** The login belongs to another PoliNetwork Auth user. */
  | "account-in-use"
  /** The sign-in page or its request expired. */
  | "expired"
  /** The browser lost the sign-in on the way (state cookie, another tab). A retry fixes it. */
  | "lost"
  /** Too many attempts. */
  | "rate-limited"
  /** The application itself isn't set up correctly. Nothing the person can do. */
  | "application"
  /** Anything else. */
  | "failed";

const KINDS: Record<string, ErrorKind> = {
  access_denied: "cancelled",
  user_cancelled: "cancelled",
  cancelled: "cancelled",
  [PROVIDER_ERROR_CODES.entraGuest]: "refused",
  [PROVIDER_ERROR_CODES.entraTenant]: "refused",
  [PROVIDER_ERROR_CODES.missingClaims]: "refused",
  // Better Auth's own code when a provider returns no account. Without one of ours recorded it
  // says nothing about why, so it's a failure, not a refusal.
  unable_to_get_user_info: "failed",
  email_not_found: "refused",
  TELEGRAM_LINK_ONLY: "refused",
  account_already_linked_to_different_user: "account-in-use",
  login_required: "expired",
  state_mismatch: "lost",
  state_not_found: "lost",
  state_invalid: "lost",
  invalid_callback_request: "lost",
  no_code: "lost",
  too_many_requests: "rate-limited",
  invalid_client: "application",
  client_disabled: "application",
  invalid_redirect: "application",
  unauthorized_client: "application",
  unsupported_response_type: "application",
  unsupported_prompt_select_account: "application",
};

export function errorKind(code: string): ErrorKind {
  return Object.hasOwn(KINDS, code) ? KINDS[code] : "failed";
}

/** What Better Auth, the provider plugin and our providers use as codes: short and plain. */
const CODE_SHAPE = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * The code `/error` works with, from the URL's `error`. The page shows the code for support, so
 * anything that isn't shaped like one becomes `unknown`: a crafted link can't put its own words
 * on the page in place of a code.
 */
export function errorCode(raw: string | undefined) {
  return raw && CODE_SHAPE.test(raw) ? raw : "unknown";
}

/** How the page names a provider, from the id in its callback path. */
export const PROVIDER_NAMES: Record<string, string> = {
  google: "Google",
  "pn-entra": "PoliNetwork APS",
  telegram: "Telegram",
};

export function providerName(id: string | undefined) {
  return id && Object.hasOwn(PROVIDER_NAMES, id) ? PROVIDER_NAMES[id] : null;
}

export type ErrorCopy = {
  title: string;
  message: string;
  /** Whether to show the code in small type, for support. Not for a plain cancel. */
  showCode: boolean;
};

/**
 * What `/error` says about `code`. Only fixed copy is shown: the `error_description` in the URL
 * is never displayed, so a crafted link can't put its own words on PoliNetwork's page.
 */
export function describeError(
  code: string,
  details: { provider?: string; retryAfter?: number } = {},
): ErrorCopy {
  const provider = providerName(details.provider);
  const at = provider ? ` with ${provider}` : "";
  switch (code) {
    case PROVIDER_ERROR_CODES.entraGuest:
    case PROVIDER_ERROR_CODES.entraTenant:
      return {
        title: "This account can't use PoliNetwork APS",
        message:
          "Only PoliNetwork APS accounts can sign in with PoliNetwork APS. Use Google instead, or ask IT for an association account.",
        showCode: true,
      };
    case "TELEGRAM_LINK_ONLY":
      return {
        title: "Telegram can't be used to sign in",
        message: "Sign in with Google or PoliNetwork APS, then link Telegram from your account.",
        showCode: true,
      };
  }
  switch (errorKind(code)) {
    case "cancelled":
      return {
        title: "You cancelled signing in",
        message: `Nothing changed. Try again when you're ready.`,
        showCode: false,
      };
    case "refused":
      return {
        title: "We couldn't verify your account",
        message: `${provider ?? "The provider"} didn't give us what we need to sign you in. Try again, or use another way to sign in.`,
        showCode: true,
      };
    case "account-in-use":
      return {
        title: `This ${provider ? `${provider} ` : ""}account belongs to another PoliNetwork account`,
        message: `You've used it with a different PoliNetwork Auth account than the one you're signed in with now. ${accountInUseAdvice(details.provider)}`,
        showCode: true,
      };
    case "expired":
      return {
        title: "This sign-in expired",
        message: "For your security, sign-in pages only last a few minutes. Start again.",
        showCode: true,
      };
    case "lost":
      return {
        title: "This sign-in couldn't be completed",
        message: `It took too long, or it started in another browser or tab. Try again${at}.`,
        showCode: true,
      };
    case "rate-limited": {
      const seconds = details.retryAfter && details.retryAfter > 0 ? details.retryAfter : null;
      return {
        title: "Too many attempts",
        message: seconds
          ? `Wait ${seconds === 1 ? "1 second" : `${seconds} seconds`}, then try again.`
          : "Wait a minute, then try again.",
        showCode: false,
      };
    }
    case "application":
      return {
        title: "This application can't sign you in",
        message:
          "It isn't set up correctly with PoliNetwork Auth. Tell the people who run it, and mention the code below.",
        showCode: true,
      };
    default:
      return {
        title: "Something went wrong",
        message: `We couldn't sign you in${at}. Try again, and if it keeps happening, tell the IT team and mention the code below.`,
        showCode: true,
      };
  }
}

/**
 * What to do about a login that belongs to another PoliNetwork Auth user, until accounts can be
 * merged (#102). Telegram is never an account's only login, so it can always be unlinked from
 * the other account; a Google or PoliNetwork APS login often is, and the last one can't be.
 */
export function accountInUseAdvice(providerId: string | undefined) {
  const name = providerName(providerId);
  if (providerId === "telegram")
    return "Sign in with that other account, unlink Telegram from it, then try again here. If you can't, ask the IT team.";
  return `If that account has another way to sign in, use it to sign in and unlink ${name ?? "this login"} there, then try again here. Otherwise ask the IT team: accounts can't be merged yet.`;
}

/**
 * The OAuth error an application gets when the person goes back to it from `/error`: a refusal
 * is `access_denied`, anything else `server_error`. A cancel never reaches `/error`.
 */
export function clientErrorFor(code: string): { error: string; description: string } {
  switch (errorKind(code)) {
    case "cancelled":
      return { error: "access_denied", description: "The person cancelled signing in." };
    case "refused":
    case "account-in-use":
      return {
        error: "access_denied",
        description: "PoliNetwork Auth couldn't accept the account the person signed in with.",
      };
    case "expired":
      return {
        error: "login_required",
        description: "The sign-in page expired. Start the sign-in again.",
      };
    default:
      return { error: "server_error", description: "The sign-in failed. Start it again." };
  }
}

export type ClientReturn = {
  redirectUri: string;
  state?: string;
  /** `fragment` when the request asked for it or for a token in the fragment (OIDC Core §5). */
  responseMode: "query" | "fragment";
};

/** How an authorization request wants its response: the same rule as the provider plugin. */
export function responseModeOf(query: URLSearchParams): "query" | "fragment" {
  const mode = query.get("response_mode");
  if (mode === "fragment" || mode === "query") return mode;
  return /\b(token|id_token)\b/.test(query.get("response_type") ?? "") ? "fragment" : "query";
}

/** The redirect that hands `error` to an application, with `state` and `iss` (RFC 9207). */
export function clientErrorUrl(
  target: ClientReturn,
  error: { error: string; description: string },
  issuer: string,
) {
  const params = new URLSearchParams({ error: error.error, error_description: error.description });
  if (target.state) params.set("state", target.state);
  // The provider plugin publishes its issuer without a trailing slash.
  params.set("iss", issuer.replace(/\/$/, ""));
  if (target.responseMode === "fragment") return `${target.redirectUri}#${params}`;
  return `${target.redirectUri}${target.redirectUri.includes("?") ? "&" : "?"}${params}`;
}

const LOOPBACK_IP = /^(127(\.\d{1,3}){3}|\[::1\])$/;

/**
 * Whether `requested` is one of `registered`: exactly, or a loopback IP address on another port
 * (RFC 8252 §7.3), the same rule the provider plugin applies at `/oauth2/authorize`.
 */
export function isRegisteredRedirect(registered: readonly string[], requested: string) {
  let req: URL;
  try {
    req = new URL(requested);
  } catch {
    return false;
  }
  return registered.some((uri) => {
    if (uri === requested) return true;
    try {
      const reg = new URL(uri);
      return (
        LOOPBACK_IP.test(reg.hostname) &&
        reg.hostname === req.hostname &&
        reg.protocol === req.protocol &&
        reg.pathname === req.pathname &&
        reg.search === req.search
      );
    } catch {
      return false;
    }
  });
}

/** Parameters the provider plugin adds to the request it signs; never part of the original. */
const SIGNING_PARAMS = new Set(["sig", "exp", "ba_iat", "ba_pl", "ba_param"]);

/** The authorization request a signed sign-in query was made from. */
export function authorizationRequestOf(query: URLSearchParams) {
  const request = new URLSearchParams();
  for (const [key, value] of query) if (!SIGNING_PARAMS.has(key)) request.append(key, value);
  return request;
}

/** When a signed sign-in query stops working, in milliseconds, or null without one. */
export function signedQueryExpiry(search: string) {
  const params = new URLSearchParams(search);
  if (!params.has("sig")) return null;
  const exp = Number(params.get("exp"));
  return Number.isFinite(exp) && exp > 0 ? exp * 1000 : null;
}

export type CallbackErrorRoute =
  /** Straight back to the application, with this URL. */
  | { to: "client"; url: string }
  /** To Auth's error page with this code; `withApp` when it can offer the application. */
  | { to: "page"; code: string; provider?: string; withApp: boolean }
  /** Not for the error page (a flow with its own error callback, like `/link`): leave it. */
  | null;

/**
 * Where a provider callback that failed should go. `location` is where Better Auth was sending
 * it; `providerError` is our own code, when one of our providers couldn't return an account; `client` is the
 * application whose sign-in this was, when there is one and its redirect URI is trusted.
 */
/** Whether a redirect is to Auth's error page, which is all `routeCallback` takes over. */
export function isErrorPageUrl(location: string, errorPage: string) {
  const page = new URL(errorPage);
  try {
    const target = new URL(location, page);
    return target.origin === page.origin && target.pathname === page.pathname;
  } catch {
    return false;
  }
}

export function routeCallback(input: {
  location: string;
  errorPage: string;
  providerError: string | null;
  provider?: string;
  client: ClientReturn | null;
  issuer: string;
}): CallbackErrorRoute {
  if (!isErrorPageUrl(input.location, input.errorPage)) return null;
  let code = new URL(input.location, input.errorPage).searchParams.get("error") || "unknown";
  if (code === "unable_to_get_user_info" && input.providerError) code = input.providerError;
  if (input.client && errorKind(code) === "cancelled")
    return { to: "client", url: clientErrorUrl(input.client, clientErrorFor(code), input.issuer) };
  return { to: "page", code, provider: input.provider, withApp: !!input.client };
}
