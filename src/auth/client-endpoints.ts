/**
 * The provider's own client mutation endpoints. They check privileges and then write in a
 * separate statement, outside the RBAC write lock that promotion to API access takes, so a
 * writer could rotate or delete a client in the middle of its promotion. Applications are
 * changed only through the server functions in `oidc.functions.ts`, which check and write in
 * one serialized transaction. These paths are closed over HTTP.
 */
export const rawClientMutationPaths = [
  "/oauth2/create-client",
  "/oauth2/update-client",
  "/oauth2/delete-client",
  "/oauth2/client/rotate-secret",
];

/** Refused to server-side `auth.api` callers too, for the same reason. */
export const refusedClientMutationPaths = [
  ...rawClientMutationPaths,
  "/admin/oauth2/update-client",
];
