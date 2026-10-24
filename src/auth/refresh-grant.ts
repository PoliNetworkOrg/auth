const running = new Map<string, Promise<void>>();

/** The refresh token a token request presents, or null for any other request. */
async function presentedRefreshToken(request: Request) {
  if (request.method !== "POST" || !new URL(request.url).pathname.endsWith("/oauth2/token"))
    return null;
  const text = await request.clone().text();
  let body: unknown;
  try {
    body = request.headers.get("content-type")?.includes("application/json")
      ? JSON.parse(text)
      : Object.fromEntries(new URLSearchParams(text));
  } catch {
    return null;
  }
  if (typeof body !== "object" || body === null) return null;
  const { grant_type, refresh_token } = body as Record<string, unknown>;
  return grant_type === "refresh_token" && typeof refresh_token === "string" && refresh_token
    ? refresh_token
    : null;
}

/**
 * Handles refresh grants that present the same refresh token one at a time.
 *
 * An app may refresh one token from several requests at once: Flux Web does when a page loads
 * its data just after the ID token expired. The provider rotates the token for the first request
 * and refuses the others with `invalid_grant`, which signs the person out. In turn, the later
 * requests find the token just rotated and get the first response again, through the provider's
 * `refreshTokenReuseInterval` replay. The queue is per process; production runs one replica.
 */
export async function serializeRefreshGrant(
  request: Request,
  handle: () => Promise<Response>,
): Promise<Response> {
  const token = await presentedRefreshToken(request);
  if (!token) return handle();
  const response = (running.get(token) ?? Promise.resolve()).then(handle);
  const done = response.then(
    () => undefined,
    () => undefined,
  );
  running.set(token, done);
  try {
    return await response;
  } finally {
    if (running.get(token) === done) running.delete(token);
  }
}
