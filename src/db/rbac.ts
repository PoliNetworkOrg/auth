import {
  boolean,
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { user } from "./auth-schema";

const now = () => timestamp({ withTimezone: true }).defaultNow().notNull();

/** A single capability an application can check for, addressed by its stable `key`. */
export const permission = pgTable(
  "permission",
  {
    id: text().primaryKey(),
    key: text().notNull(),
    name: text().notNull(),
    description: text(),
    createdAt: now(),
    updatedAt: now(),
  },
  (table) => [uniqueIndex("permission_key_uidx").on(table.key)],
);

/**
 * Permission hierarchy: holding `permission_id` also grants `implied_permission_id`.
 * Edges are transitive and the writers reject any edge that would close a cycle.
 */
export const permissionImplication = pgTable(
  "permission_implication",
  {
    permissionId: text("permission_id")
      .notNull()
      .references(() => permission.id, { onDelete: "cascade" }),
    impliedPermissionId: text("implied_permission_id")
      .notNull()
      .references(() => permission.id, { onDelete: "cascade" }),
  },
  (table) => [
    primaryKey({ columns: [table.permissionId, table.impliedPermissionId] }),
    index("permissionImplication_implied_idx").on(table.impliedPermissionId),
  ],
);

/**
 * A named bundle of permissions.
 *
 * `managed` roles (Socio, Student, Direttivo) are seeded by the application and their
 * membership is inferred from identity evidence through `source_state`. They cannot be
 * created, deleted, rekeyed, or handed out by an administrator; only the permissions they
 * carry are editable.
 */
export const role = pgTable(
  "role",
  {
    id: text().primaryKey(),
    key: text().notNull(),
    name: text().notNull(),
    description: text(),
    managed: boolean().default(false).notNull(),
    sourceState: text("source_state"),
    createdAt: now(),
    updatedAt: now(),
  },
  (table) => [uniqueIndex("role_key_uidx").on(table.key)],
);

/** Role hierarchy: `role_id` inherits every permission of `parent_role_id`. */
export const roleParent = pgTable(
  "role_parent",
  {
    roleId: text("role_id")
      .notNull()
      .references(() => role.id, { onDelete: "cascade" }),
    parentRoleId: text("parent_role_id")
      .notNull()
      .references(() => role.id, { onDelete: "cascade" }),
  },
  (table) => [
    primaryKey({ columns: [table.roleId, table.parentRoleId] }),
    index("roleParent_parent_idx").on(table.parentRoleId),
  ],
);

export const rolePermission = pgTable(
  "role_permission",
  {
    roleId: text("role_id")
      .notNull()
      .references(() => role.id, { onDelete: "cascade" }),
    permissionId: text("permission_id")
      .notNull()
      .references(() => permission.id, { onDelete: "cascade" }),
  },
  (table) => [
    primaryKey({ columns: [table.roleId, table.permissionId] }),
    index("rolePermission_permission_idx").on(table.permissionId),
  ],
);

/** Hand-made assignments. Managed roles never appear here; they come from evidence. */
export const userRole = pgTable(
  "user_role",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    roleId: text("role_id")
      .notNull()
      .references(() => role.id, { onDelete: "cascade" }),
    // Kept as a plain identifier so the audit trail survives the administrator's deletion.
    assignedBy: text("assigned_by"),
    assignedAt: now(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.roleId] }),
    index("userRole_role_idx").on(table.roleId),
  ],
);
