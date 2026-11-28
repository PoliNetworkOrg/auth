/**
 * Better Auth's own account endpoints that no page here calls. These paths are closed over HTTP;
 * server-side `auth.api` calls are not affected.
 *
 * - `/update-user`: anyone signed in could set their own name and picture to anything, and that
 *   name is what applications, administrators and the e-signing picker see. People change a
 *   self-declared name through `saveNameFn` instead, with the limits in `names.ts`.
 * - `/update-session`: nothing here lets a session be edited.
 * - `/get-access-token`, `/refresh-token`, `/account-info`: they hand the Google, Entra or
 *   Telegram tokens and profile behind a linked account to the browser.
 * - `/delete-user`, `/delete-user/callback`: people are deleted from the user pages, which
 *   check permissions. Better Auth's own deletion is off.
 * - The rest belong to email and password sign-in and email changes, which are off here.
 */
export const unusedAccountPaths = [
  "/update-user",
  "/update-session",
  "/get-access-token",
  "/refresh-token",
  "/account-info",
  "/delete-user",
  "/delete-user/callback",
  "/change-email",
  "/change-password",
  "/sign-up/email",
  "/sign-in/email",
  "/request-password-reset",
  "/reset-password",
  "/send-verification-email",
  "/verify-email",
  "/verify-password",
];
