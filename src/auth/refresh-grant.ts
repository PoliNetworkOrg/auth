// A token request is a short form of known length; other bodies are not read and run unqueued.
const MAX_BODY_BYTES = 16 * 1024;
// Requests per token in the queue, the running one included; more run unqueued.
const MAX_QUEUED = 8;
// How long a request waits for the one ahead before running anyway. Below the provider's
// 10-second `refreshTokenReuseInterval`, so the replay is still there when it runs.
const MAX_WAIT_MS = 5_000;

type Queue = { last: Promise<void>; size: number };
const queues = new Map<string, Queue>();

/** The refresh token a token request presents, or null for any other request. */
async function presentedRefreshToken(request: Request) {
  if (request.method !== "POST" || !new URL(request.url).pathname.endsWith("/oauth2/token"))
    return null;
  if (!request.headers.get("content-type")?.includes("application/x-www-form-urlencoded"))
    return null;
  const length = Number(request.headers.get("content-length"));
  if (!(length > 0 && length <= MAX_BODY_BYTES)) return null;
  const body = new URLSearchParams(await request.clone().text());
  // The provider trims the grant type before matching it.
  return body.get("grant_type")?.trim() === "refresh_token"
    ? body.get("refresh_token") || null
    : null;
}

async function waitAtMost(previous: Promise<void>, ms: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([previous, new Promise<void>((resolve) => (timer = setTimeout(resolve, ms)))]);
  clearTimeout(timer);
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
  const queue = queues.get(token) ?? { last: Promise.resolve(), size: 0 };
  if (queue.size >= MAX_QUEUED) return handle();
  const previous = queue.last;
  let release = () => {};
  queue.last = new Promise((resolve) => (release = resolve));
  queue.size += 1;
  queues.set(token, queue);
  try {
    await waitAtMost(previous, MAX_WAIT_MS);
    return await handle();
  } finally {
    release();
    queue.size -= 1;
    if (queue.size === 0) queues.delete(token);
  }
}
