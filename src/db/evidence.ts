import {
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { user } from "./auth-schema";

// Evidence grants nothing until joined to an account owned by the current user.
export const identityEvidence = pgTable(
  "identity_evidence",
  {
    issuer: text().notNull(),
    subject: text().notNull(),
    providerId: text("provider_id").notNull(),
    externalId: text("external_id"),
    // Every state this account currently proves, for example ['socio', 'direttivo'].
    states: text().array().notNull().default([]),
    validUntil: timestamp("valid_until", { withTimezone: true }).notNull(),
    telegramId: text("telegram_id"),
    // The address the account signs in with, saved at each sign-in. Shown and searched, and a
    // PoliNetwork address is also what apps receive as `email` (see `appEmail`).
    email: text(),
  },
  (table) => [
    primaryKey({ columns: [table.issuer, table.subject] }),
    uniqueIndex("identity_evidence_telegram_id_uidx")
      .on(table.telegramId)
      .where(sql`${table.telegramId} IS NOT NULL`),
  ],
);

export const studentVerificationChallenge = pgTable(
  "student_verification_challenge",
  {
    userId: text("user_id")
      .primaryKey()
      .references(() => user.id, { onDelete: "cascade" }),
    email: text().notNull(),
    codeHash: text("code_hash").notNull(),
    attempts: integer().default(0).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    lastSentAt: timestamp("last_sent_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex("studentVerificationChallenge_email_uidx").on(table.email),
    index("studentVerificationChallenge_expiresAt_idx").on(table.expiresAt),
  ],
);
