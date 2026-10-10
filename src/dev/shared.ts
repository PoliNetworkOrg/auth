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

/**
 * Keeps the post-sign-in redirect on this origin. Anything that is not a plain local path,
 * including protocol-relative and backslash tricks, falls back to the home page.
 */
export function localRedirect(value: string | null | undefined) {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\"))
    return "/";
  const base = "http://dev.invalid";
  const url = new URL(value, base);
  return url.origin === base ? `${url.pathname}${url.search}${url.hash}` : "/";
}

export function devLoginHref(key: string, redirect: string) {
  return `${DEV_LOGIN_PATH}?${new URLSearchParams({ as: key, redirect })}`;
}
