-- Deleting someone's account is irreversible, so it is its own managed permission rather
-- than part of browsing or managing roles. Only Master Admin holds it until granted.
-- This key was not reserved before, so an administrator may have created a custom
-- permission with it. Adopting that row would turn a delegable permission into the
-- deletion gate, so stop and let an operator rename or remove it first.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "permission" WHERE "key" = 'idp:users:delete' AND NOT "managed") THEN
    RAISE EXCEPTION 'A custom permission already uses the key idp:users:delete. Rename or delete it, then rerun the migration.';
  END IF;
END;
$$;--> statement-breakpoint
INSERT INTO "permission" ("id", "key", "name", "description", "managed") VALUES
	('managed-permission-idp-users-delete', 'idp:users:delete', 'Delete users', 'Permanently delete someone''s account, with their linked accounts, passkeys, sessions, and roles.', true)
ON CONFLICT ("key") DO NOTHING;--> statement-breakpoint
-- Stored for display; the code also applies it whatever the stored graph says.
INSERT INTO "permission_implication" ("permission_id", "implied_permission_id")
SELECT deleter.id, reader.id
FROM "permission" deleter, "permission" reader
WHERE deleter.key = 'idp:users:delete' AND reader.key = 'idp:users:read'
ON CONFLICT DO NOTHING;
