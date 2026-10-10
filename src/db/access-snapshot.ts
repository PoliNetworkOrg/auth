import { bigint, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

/** Last successful direct-member listing for each configured Entra group. */
export const entraGroupObservation = pgTable("entra_group_observation", {
  source: text().primaryKey(),
  groupId: text("group_id").notNull(),
  members: text().array().notNull(),
  observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
});

/** Persisted response makes unchanged pulls byte-identical, even across IdP replicas. */
export const accessSnapshotState = pgTable("access_snapshot_state", {
  projection: text().primaryKey(),
  generation: integer().notNull(),
  fingerprint: text().notNull(),
  body: text().notNull(),
});

/** Changes to snapshot inputs are queued in the same database transaction as the write. */
export const accessOutbox = pgTable("access_outbox", {
  id: bigint({ mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  projection: text().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  attempts: integer().default(0).notNull(),
  nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).defaultNow().notNull(),
});
