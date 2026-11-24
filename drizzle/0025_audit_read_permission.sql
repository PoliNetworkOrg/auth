-- The backend's central audit log records every change made across PoliNetwork, and the admin
-- dashboard shows it to whoever holds `audit:read`. Like the rest of the migration catalog it is
-- an ordinary permission: no role is given it, and Master Admin covers it through its wildcard.
-- A permission an administrator already created by hand is left untouched.
INSERT INTO "permission" ("id", "key", "name", "description", "managed") VALUES
	('migration-permission-audit-read', 'audit:read', 'Read the audit log', 'See every change made across PoliNetwork in the admin dashboard: who made it, on what, and the state before and after.', false)
ON CONFLICT ("key") DO NOTHING;
