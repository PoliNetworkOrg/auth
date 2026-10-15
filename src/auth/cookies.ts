/**
 * Prefix for every cookie this server sets.
 *
 * Other PoliNetwork services still run Better Auth with its default `better-auth` prefix
 * and scope their cookies to `.polinetwork.org`, so browsers send those cookies here as
 * well. With matching names the older, domain-wide session cookie is read first: its
 * signature fails against our secret and the person looks signed out. Someone signing in
 * for the first time then loops between the consent page and the login page. A distinct
 * prefix keeps our cookies apart from theirs.
 */
export const AUTH_COOKIE_PREFIX = "pn-identity";

/**
 * Set in a browser that cannot create passkeys, so its sign-ins skip the passkey offer for
 * the rest of the browser session instead of coming back to it. The person never saw the
 * offer, so it is not recorded as declined.
 */
export const PASSKEY_UNSUPPORTED_COOKIE = `${AUTH_COOKIE_PREFIX}.passkey-unsupported`;
