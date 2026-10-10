import { lt } from "drizzle-orm";
import { db } from "../db";
import { jwks } from "../db/schema";
import { jwtOptions } from "./jwt-options";

/**
 * Deletes signing keys whose grace period has ended; they are no longer published or used.
 * Better Auth reads at most 100 key rows, so keeping every retired key would eventually
 * hide the current ones.
 */
export async function pruneRetiredKeys() {
  const cutoff = new Date(Date.now() - jwtOptions.jwks.gracePeriod * 1000);
  await db.delete(jwks).where(lt(jwks.expiresAt, cutoff));
}

export function startKeyPruning() {
  const tick = () =>
    pruneRetiredKeys().catch(() => console.error("Signing key pruning failed; retrying later."));
  const timer = setInterval(() => void tick(), 24 * 60 * 60 * 1000);
  timer.unref();
  void tick();
}
