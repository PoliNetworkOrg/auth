import { randomUUID } from "node:crypto";
import { sql, type SQL } from "drizzle-orm";
import type { BetterAuthOptions, BetterAuthRateLimitStorage } from "better-auth";

type Executor = { execute(query: SQL): Promise<{ rows: Record<string, unknown>[] }> };
type IpAddressOptions = NonNullable<NonNullable<BetterAuthOptions["advanced"]>["ipAddress"]>;

/**
 * Which request header carries the client address, and which proxy hops may precede it in
 * `x-forwarded-for`. Only a header the trusted edge overwrites may be named here: a header a
 * client can still set on its way to this process lets it choose its own bucket. Without a
 * resolvable address Better Auth puts every caller of a path into one shared bucket.
 */
export function clientIpOptions(config: {
  AUTH_CLIENT_IP_HEADER?: string;
  AUTH_TRUSTED_PROXIES?: string[];
}): IpAddressOptions {
  return {
    ...(config.AUTH_CLIENT_IP_HEADER && { ipAddressHeaders: [config.AUTH_CLIENT_IP_HEADER] }),
    ...(config.AUTH_TRUSTED_PROXIES?.length && { trustedProxies: config.AUTH_TRUSTED_PROXIES }),
  };
}

/**
 * Token requests from a server (an app's backend exchanging codes and refreshing for all its
 * users, or a service using client credentials) share one bucket per egress address, or the
 * shared no-address bucket when they reach this process internally. Every grant needs a
 * high-entropy code, refresh token, secret or signed assertion, so this budget bounds load
 * rather than guessing: one token a second per address. The provider default is 20.
 */
export const oauthRateLimit = { token: { window: 60, max: 60 } };

// Rows older than this are expired under every rule, so they can be deleted.
const RETENTION_MS = 60 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 60 * 1000;

/**
 * Fixed-window rate limiting in the shared `rate_limit` table, so every replica enforces the
 * same counts. `last_request` holds the start of the key's current window, not its latest
 * request: neither accepted nor refused requests move it, so a window always ends `window`
 * seconds after its first request, and steady traffic below the limit is never refused.
 * Any `window` seconds admit at most twice `max`, at a window boundary.
 *
 * Better Auth's own database storage extends the window on every accepted request and checks
 * the limit in a subquery outside the row lock, so it refuses steady traffic and admits too
 * much under concurrency. Here one `INSERT ... ON CONFLICT DO UPDATE` decides each request
 * against the locked, latest row. Times come from the database clock, shared by every replica,
 * unless a test supplies `now`. Database errors propagate, refusing the request.
 */
export function postgresRateLimitStorage(
  db: Executor,
  options: { now?: () => number } = {},
): BetterAuthRateLimitStorage {
  let retentionMs = RETENTION_MS;
  let nextCleanup = 0;

  const cleanup = (now: number) => {
    if (now < nextCleanup) return;
    nextCleanup = now + CLEANUP_INTERVAL_MS;
    db.execute(sql`delete from rate_limit where last_request < ${now - retentionMs}`).catch(
      (error) => console.error("Rate limit cleanup failed; retrying later.", error),
    );
  };

  return {
    async consume(key, rule) {
      const windowMs = rule.window * 1000;
      retentionMs = Math.max(retentionMs, windowMs);
      const now = options.now?.() ?? null;
      const { rows } = await db.execute(sql`
        with clock as (
          select coalesce(
            ${now}::bigint,
            floor(extract(epoch from clock_timestamp()) * 1000)::bigint
          ) as now
        ), upsert as (
          insert into rate_limit as current (id, key, count, last_request)
          select ${randomUUID()}, ${key}, 1, clock.now from clock
          on conflict (key) do update set
            count = case
              when excluded.last_request >= current.last_request + ${windowMs} then 1
              else least(current.count + 1, ${rule.max + 1})
            end,
            last_request = case
              when excluded.last_request >= current.last_request + ${windowMs}
                then excluded.last_request
              else current.last_request
            end
          returning current.count, current.last_request
        )
        select upsert.count, upsert.last_request as window_start, clock.now
        from upsert, clock
      `);
      const row = rows[0];
      const count = Number(row?.count);
      const windowStart = Number(row?.window_start);
      const at = Number(row?.now);
      cleanup(at);
      if (count <= rule.max) return { allowed: true, retryAfter: null };
      const remaining = Math.ceil((windowStart + windowMs - at) / 1000);
      return { allowed: false, retryAfter: Math.min(Math.max(remaining, 1), rule.window) };
    },
  };
}

const RETRY_MESSAGE = "Too many requests. Please try again later.";

/**
 * Better Auth answers a limited request with a bare JSON body and only `X-Retry-After`. This
 * adds the standard `Retry-After`, a content type and `no-store`, and shows a browser that
 * navigated here a short page instead of raw JSON. It never retries or reloads on its own.
 */
export function rateLimitedResponse(request: Request, response: Response): Response {
  const retryAfter = Number.parseInt(response.headers.get("x-retry-after") ?? "", 10);
  const seconds = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : 60;
  const headers = new Headers({
    "retry-after": String(seconds),
    "x-retry-after": String(seconds),
    "cache-control": "no-store",
  });
  const navigation =
    request.method === "GET" &&
    (request.headers.get("sec-fetch-mode") === "navigate" ||
      (request.headers.get("accept") ?? "").includes("text/html"));
  if (!navigation) {
    headers.set("content-type", "application/json");
    const body = { code: "TOO_MANY_REQUESTS", message: RETRY_MESSAGE, retryAfter: seconds };
    return new Response(JSON.stringify(body), { status: 429, headers });
  }
  headers.set("content-type", "text/html; charset=utf-8");
  const wait = seconds === 1 ? "1 second" : `${seconds} seconds`;
  return new Response(
    `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Too many attempts · PoliNetwork Auth</title>
<style>body{font-family:system-ui,sans-serif;max-width:32rem;margin:15vh auto;padding:0 1.5rem;line-height:1.5;color-scheme:light dark}h1{font-size:1.25rem}</style>
</head>
<body>
<h1>Too many attempts</h1>
<p>Wait ${wait}, then go back to the app and sign in again.</p>
</body>
</html>
`,
    { status: 429, headers },
  );
}
