-- Browsing the people registered here, with their linked accounts and verified status, is
-- a managed permission like the rest of this service's administration, so it can be given
-- to any role. Master Admin covers it through its wildcard as soon as it exists.
-- This key was not reserved before, so an administrator may have created a custom
-- permission with it. Adopting that row would turn a delegable permission into the
-- directory's gate, so stop and let an operator rename or remove it first.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "permission" WHERE "key" = 'idp:users:read' AND NOT "managed") THEN
    RAISE EXCEPTION 'A custom permission already uses the key idp:users:read. Rename or delete it, then rerun the migration.';
  END IF;
END;
$$;--> statement-breakpoint
INSERT INTO "permission" ("id", "key", "name", "description", "managed") VALUES
	('managed-permission-idp-users-read', 'idp:users:read', 'View users', 'Browse everyone registered with this identity provider, with their linked accounts and verified status.', true)
ON CONFLICT ("key") DO NOTHING;--> statement-breakpoint
-- Someone who can browse everyone can already find them by name, so the people search
-- follows by default. Like the other seeded implications, this one stays editable.
INSERT INTO "permission_implication" ("permission_id", "implied_permission_id")
SELECT users.id, people.id
FROM "permission" users, "permission" people
WHERE users.key = 'idp:users:read' AND people.key = 'idp:people:read'
ON CONFLICT DO NOTHING;
