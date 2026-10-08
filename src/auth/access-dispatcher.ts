import { signJWT } from "better-auth/plugins/jwt";
import { and, asc, eq, inArray, lte, sql } from "drizzle-orm";
import { db } from "../db";
import { accessOutbox } from "../db/schema";
import { env } from "../env";
import type { auth } from "./index";

type Auth = typeof auth;
const EVENT = "https://schemas.polinetwork.org/events/access-changed";

/** One bounded batch; row locks prevent competing IdP instances from sending it together. */
export async function dispatchAccessChanges(identityProvider: Auth): Promise<boolean> {
  const endpoint = env.OAUTH_BACKEND_EVENTS_URL;
  const audience = env.OAUTH_BACKEND_RESOURCE_URI;
  if (!endpoint || !audience) return false;
  return db.transaction(async (transaction) => {
    const rows = await transaction
      .select({ id: accessOutbox.id, attempts: accessOutbox.attempts })
      .from(accessOutbox)
      .where(
        and(eq(accessOutbox.projection, "backend"), lte(accessOutbox.nextAttemptAt, new Date())),
      )
      .orderBy(asc(accessOutbox.id))
      .limit(100)
      .for("update", { skipLocked: true });
    if (!rows.length) return false;

    const ids = rows.map((row) => row.id);
    const eventId = `access-${ids[0]}`;
    let delivered = false;
    try {
      const now = Math.floor(Date.now() / 1000);
      const token = await signJWT(
        { context: await identityProvider.$context } as Parameters<typeof signJWT>[0],
        {
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

    if (delivered) {
      await transaction.delete(accessOutbox).where(inArray(accessOutbox.id, ids));
    } else {
      const attempts = Math.max(...rows.map((row) => row.attempts)) + 1;
      const delay = Math.min(60_000, 1_000 * 2 ** Math.min(attempts, 6));
      await transaction
        .update(accessOutbox)
        .set({
          attempts: sql`${accessOutbox.attempts} + 1`,
          nextAttemptAt: new Date(Date.now() + delay),
        })
        .where(inArray(accessOutbox.id, ids));
      console.warn("Access-change delivery deferred.", { eventId, attempts });
    }
    return true;
  });
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
