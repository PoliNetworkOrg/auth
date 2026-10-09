-- Assigning roles is delegated separately from editing them (RFC §4 decision 7). Neither
-- permission implies the other, and existing `idp:roles:write` holders are deliberately not
-- granted assignment here: administrators review them and grant it by hand where intended.
-- Master Admin covers the new key through its wildcard.
INSERT INTO "permission" ("id", "key", "name", "description", "managed") VALUES
	('managed-permission-idp-roles-assign', 'idp:roles:assign', 'Assign roles', 'Give roles to people and take them away. Changing what a role grants is a separate permission.', true)
ON CONFLICT ("key") DO NOTHING;--> statement-breakpoint
-- Assigning a role means seeing it and finding the person to give it to.
INSERT INTO "permission_implication" ("permission_id", "implied_permission_id")
SELECT assign.id, implied.id
FROM "permission" assign
JOIN "permission" implied ON implied.key IN ('idp:roles:read', 'idp:people:read')
WHERE assign.key = 'idp:roles:assign'
ON CONFLICT DO NOTHING;--> statement-breakpoint
UPDATE "permission"
SET "description" = 'Create, change, and delete roles. Giving them to people is a separate permission.'
WHERE "key" = 'idp:roles:write'
	AND "description" = 'Create, change, and delete roles, and give them to people.';
