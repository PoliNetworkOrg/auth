ALTER TABLE "role" ADD COLUMN "people_binding" text;--> statement-breakpoint
ALTER TABLE "role" ADD CONSTRAINT "role_people_binding_check" CHECK ("role"."people_binding" is null or (not "role"."managed" and "role"."people_binding" ~ '^(admin|capo|team:[a-z0-9-]{1,32}:(member|lead))$'));--> statement-breakpoint
-- Binding a role to People is delegated like every other administrative right. No role is
-- given it; Master Admin covers the new key through its wildcard.
INSERT INTO "permission" ("id", "key", "name", "description", "managed") VALUES
	('managed-permission-idp-people-bind', 'idp:people:bind', 'Bind roles to People', 'Choose which roles the admin dashboard''s People register manages, and what holding each one means there.', true)
ON CONFLICT ("key") DO NOTHING;--> statement-breakpoint
-- Binding a role means seeing what it grants.
INSERT INTO "permission_implication" ("permission_id", "implied_permission_id")
SELECT bind.id, implied.id
FROM "permission" bind
JOIN "permission" implied ON implied.key = 'idp:roles:read'
WHERE bind.key = 'idp:people:bind'
ON CONFLICT DO NOTHING;
