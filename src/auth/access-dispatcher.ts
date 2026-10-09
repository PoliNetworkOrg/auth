import { signJWT } from "better-auth/plugins/jwt";
import { and, asc, eq, inArray, lte, sql } from "drizzle-orm";
import { db } from "../db";
import { accessOutbox } from "../db/schema";
import { env } from "../env";
import type { auth } from "./index";
import { jwtOptions } from "./jwt-options";

type Auth = typeof auth;
const EVENT = "https://schemas.polinetwork.org/events/access-changed";
// Longer than signing plus the request timeout, so a crashed sender's rows are retried.
const LEASE = sql`now() + interval '30 seconds'`;

/** Claims due rows under a lease and commits, so no lock or connection is held while sending. */
async function claimAccessChanges() {
  return db.transaction(async (transaction) => {
    const rows = await transaction
      .select({ id: accessOutbox.id, attempts: accessOutbox.attempts })
      .from(accessOutbox)
      .where(
        and(eq(accessOutbox.projection, "backend"), lte(accessOutbox.nextAttemptAt, sql`now()`)),
      )
      .orderBy(asc(accessOutbox.id))
      .limit(1_000)
      .for("update", { skipLocked: true });
    if (!rows.length) return null;
    const ids = rows.map((row) => row.id);
    await transaction
      .update(accessOutbox)
      .set({ attempts: sql`${accessOutbox.attempts} + 1`, nextAttemptAt: LEASE })
      .where(inArray(accessOutbox.id, ids));
    return { ids, attempts: Math.max(...rows.map((row) => row.attempts)) + 1 };
  });
}

/** Sends one event for every claimed row; competing IdP instances claim disjoint rows. */
export async function dispatchAccessChanges(identityProvider: Auth): Promise<boolean> {
  const endpoint = env.OAUTH_BACKEND_EVENTS_URL;
  const audience = env.OAUTH_BACKEND_RESOURCE_URI;
  if (!endpoint || !audience) return false;
  const claimed = await claimAccessChanges();
  if (!claimed) return false;

  const { ids, attempts } = claimed;
  const eventId = `access-${ids[0]}`;
  let delivered = false;
  try {
    const now = Math.floor(Date.now() / 1000);
    const token = await signJWT(
      { context: await identityProvider.$context } as Parameters<typeof signJWT>[0],
      {
        options: jwtOptions,
        payload: {
          iss: new URL("/api/auth", env.BETTER_AUTH_URL).href,
          aud: audience,
          jti: eventId,
          iat: now,
          exp: now + 60,
          events: { [EVENT]: { projection: "backend" } },
        },
        header: { typ: "secevent+jwt" },
        signingAlgorithm: "EdDSA",
      },
    );
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/secevent+jwt" },
      body: token,
      signal: AbortSignal.timeout(8_000),
    });
    delivered = response.status === 202;
  } catch {
    // A missing receiver, timeout, or signing error leaves the work durable for retry.
  }

  const pending = and(eq(accessOutbox.projection, "backend"), eq(accessOutbox.attempts, 0));
  if (delivered) {
    await db.transaction(async (transaction) => {
      await transaction.delete(accessOutbox).where(inArray(accessOutbox.id, ids));
      // Changes queued during delivery waited behind its lease; announce them now.
      await transaction
        .update(accessOutbox)
        .set({ nextAttemptAt: sql`now()` })
        .where(pending);
    });
    return true;
  }

  const delay = Math.min(60_000, 1_000 * 2 ** Math.min(attempts, 6));
  const retryAt = sql`now() + interval '${sql.raw(String(delay))} milliseconds'`;
  const [kept, ...merged] = ids;
  await db.transaction(async (transaction) => {
    // Every row announces the same projection, so one retry covers them all.
    if (merged.length)
      await transaction.delete(accessOutbox).where(inArray(accessOutbox.id, merged));
    await transaction
      .update(accessOutbox)
      .set({ attempts, nextAttemptAt: retryAt })
      .where(eq(accessOutbox.id, kept!));
    await transaction
      .update(accessOutbox)
      .set({ nextAttemptAt: sql`greatest(${accessOutbox.nextAttemptAt}, ${retryAt})` })
      .where(pending);
  });
  console.warn("Access-change delivery deferred.", { eventId, attempts });
  return true;
}

/** Called once by the production server after auth has been configured. */
export function startAccessDispatcher(identityProvider: Auth) {
  if (!env.OAUTH_BACKEND_EVENTS_URL || !env.OAUTH_BACKEND_RESOURCE_URI) return;
  let active = false;
  const tick = async () => {
    if (active) return;
    active = true;
    try {
      await dispatchAccessChanges(identityProvider);
    } catch {
      console.error("Access-change dispatcher failed; pending rows remain queued.");
    } finally {
      active = false;
    }
  };
  const timer = setInterval(() => void tick(), 1_000);
  timer.unref();
  void tick();
}
