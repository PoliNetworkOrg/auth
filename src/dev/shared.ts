/**
 * Shared by the dev sign-in endpoint and the login page panel. Development builds only:
 * `scripts/check-server-bundle.mjs` fails a production build that still contains
 * `DEV_LOGIN_KIND`, which is how a leak of this code into production would show up.
 */
export const DEV_LOGIN_KIND = "pn-dev-login";

export const DEV_LOGIN_PATH = "/api/dev/login";

export type DevPersonaSummary = {
  key: string;
  name: string;
  description: string;
  /** Set when the persona is missing something it needs from `.env.local`. */
  warning?: string;
};

export type DevLoginListing = { kind: typeof DEV_LOGIN_KIND; personas: DevPersonaSummary[] };

const LOCAL_BASE = "http://dev-login.invalid";

/** Control characters, which browsers strip from URLs, and `\`, which they read as `/`. */
function hasUnsafeCharacter(value: string) {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f || code === 0x5c) return true;
  }
  return false;
}

/**
 * Keeps the post-sign-in redirect on this origin. The value is resolved against a placeholder
 * origin first and the result is what gets checked, since dot segments (`/a/..//x`, also
 * percent-encoded), tabs, newlines and backslashes all change what a browser makes of it. Anything
 * that does not stay a plain local path falls back to the home page.
 */
export function localRedirect(value: string | null | undefined) {
  if (!value || !value.startsWith("/") || hasUnsafeCharacter(value)) return "/";
  let url: URL;
  try {
    url = new URL(value, LOCAL_BASE);
  } catch {
    return "/";
  }
  if (url.origin !== LOCAL_BASE) return "/";
  let decoded: string;
  try {
    decoded = decodeURIComponent(url.pathname);
  } catch {
    return "/";
  }
  // `//host` and `/\host` are protocol-relative. Also refuse anything that decodes to an empty
  // segment, a dot segment or a backslash, so nothing that decodes the path later can turn it
  // into one of those.
  if (url.pathname.startsWith("//") || /\/\/|\\|(^|\/)\.{1,2}(\/|$)/.test(decoded)) return "/";
  return `${url.pathname}${url.search}${url.hash}`;
}

/**
 * The signed OAuth query of a login page an application sent the person to, or nothing. Keeps
 * only the parameters the signature covers, as Better Auth's own client does, so anything
 * appended to the URL afterwards does not break the signature check.
 */
export function signedOAuthQuery(search: string) {
  const params = new URLSearchParams(search);
  const signed = new Set(params.getAll("ba_param"));
  if (!params.has("sig") || !signed.size) return undefined;
  const kept = new URLSearchParams();
  for (const [key, value] of params)
    if (key === "sig" || key === "ba_param" || signed.has(key)) kept.append(key, value);
  return kept.toString();
}

export function devLoginHref(key: string, redirect: string, oauthQuery?: string) {
  return `${DEV_LOGIN_PATH}?${new URLSearchParams({
    as: key,
    redirect,
    ...(oauthQuery ? { oauth_query: oauthQuery } : {}),
  })}`;
}
