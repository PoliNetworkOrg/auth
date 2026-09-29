/** Deliberately exclude query strings, request bodies, cookies and provider error details. */
export function logAuthorizationDenial(
  actorId: string | null,
  endpoint: string,
  required: readonly string[],
) {
  console.warn(JSON.stringify({ event: "authorization_denied", actorId, endpoint, required }));
}
