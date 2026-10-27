import { pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { user } from "./auth-schema";

/** Declared contacts are not provider evidence and must never establish a login identity. */
export const peopleRegistration = pgTable(
  "people_registration",
  {
    id: text()
      .primaryKey()
      .references(() => user.id, { onDelete: "cascade" }),
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull(),
    email: text(),
    phone: text(),
    telegramId: text("telegram_id"),
    telegramUsername: text("telegram_username"),
    linkedUserId: text("linked_user_id").references(() => user.id),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("people_registration_linked_user_idx").on(table.linkedUserId)],
);
