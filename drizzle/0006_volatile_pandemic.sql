ALTER TABLE "permission" ADD COLUMN "managed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- Master Admin holds every permission that exists, as a wildcard rather than a stored
-- grant list, so it keeps covering permissions created later. Its membership comes from
-- IDP_ADMIN_USER_IDS or the Entra administration policy rather than from identity evidence.
-- When no administrators group is configured, every linked PN Entra account holds it,
-- preserving the previous client-administration policy. It has no source_state because this
-- deployment configuration is the bootstrap path that prevents an administrative lockout.
INSERT INTO "role" ("id", "key", "name", "description", "managed", "source_state") VALUES
	('static-role-master-admin', 'master-admin', 'Master Admin', 'Complete control of this identity provider.', true, NULL)
ON CONFLICT ("key") DO NOTHING;--> statement-breakpoint
-- The permissions covering this identity provider's own administration. The code checks
-- for these exact keys, so they can never be created or deleted by hand; which roles carry
-- them is entirely up to the administrator.
INSERT INTO "permission" ("id", "key", "name", "description", "managed") VALUES
	('managed-permission-idp-people-read', 'idp:people:read', 'Find people', 'Search the people registered with this identity provider.', true),
	('managed-permission-idp-permissions-read', 'idp:permissions:read', 'View permissions', 'See the permissions this identity provider defines.', true),
	('managed-permission-idp-permissions-write', 'idp:permissions:write', 'Manage permissions', 'Create, change, and delete permissions, and choose what each one also grants.', true),
	('managed-permission-idp-roles-read', 'idp:roles:read', 'View roles', 'See roles, what they grant, and who holds them.', true),
	('managed-permission-idp-roles-write', 'idp:roles:write', 'Manage roles', 'Create, change, and delete roles, and give them to people.', true),
	('managed-permission-idp-applications-read', 'idp:applications:read', 'View applications', 'See the applications that sign people in with PoliNetwork Identity.', true),
	('managed-permission-idp-applications-write', 'idp:applications:write', 'Manage applications', 'Register applications, edit their redirect URIs and scopes, rotate secrets, and delete them.', true)
ON CONFLICT ("key") DO NOTHING;--> statement-breakpoint
-- Writing implies reading, managing roles implies finding the people to give them to, and
-- understanding a role means being able to see the permissions it carries.
INSERT INTO "permission_implication" ("permission_id", "implied_permission_id") VALUES
	('managed-permission-idp-permissions-write', 'managed-permission-idp-permissions-read'),
	('managed-permission-idp-roles-read', 'managed-permission-idp-permissions-read'),
	('managed-permission-idp-roles-write', 'managed-permission-idp-roles-read'),
	('managed-permission-idp-roles-write', 'managed-permission-idp-people-read'),
	('managed-permission-idp-applications-write', 'managed-permission-idp-applications-read')
ON CONFLICT DO NOTHING;
