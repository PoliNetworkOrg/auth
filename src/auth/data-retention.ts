import { lt, sql } from "drizzle-orm";
import { db } from "../db";
import {
  oauthAccessToken,
  oauthRefreshToken,
  rbacAuditEvent,
  session,
  verification,
} from "../db/schema";

/** The privacy policy deletes expired sessions within this long after they expire. */
const EXPIRED_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Deletes what the privacy policy no longer lets us keep: sessions (with their IP address and
 * user agent), verification values and OAuth tokens 30 days after they expire, and RBAC audit
 * events once they are five years old. Better Auth refuses every expired row already, so none
 * of them can still be used. Migration `0020` lets the database delete audit events only past
 * the same five years, measured with the same clock.
 */
export async function pruneExpiredData() {
  const cutoff = new Date(Date.now() - EXPIRED_RETENTION_MS);
  await db.delete(session).where(lt(session.expiresAt, cutoff));
  await db.delete(verification).where(lt(verification.expiresAt, cutoff));
  await db.delete(oauthAccessToken).where(lt(oauthAccessToken.expiresAt, cutoff));
  await db.delete(oauthRefreshToken).where(lt(oauthRefreshToken.expiresAt, cutoff));
  await db
    .delete(rbacAuditEvent)
    .where(lt(rbacAuditEvent.createdAt, sql`now() - interval '5 years'`));
}

export function startDataRetention() {
  const tick = () =>
    pruneExpiredData().catch(() => console.error("Data retention pruning failed; retrying later."));
  const timer = setInterval(() => void tick(), 24 * 60 * 60 * 1000);
  timer.unref();
  void tick();
}
