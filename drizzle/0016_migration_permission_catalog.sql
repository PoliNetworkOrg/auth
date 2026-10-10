-- The permission catalog frozen for the IdP–Telegram migration (RFC §4.1). Services check
-- these keys, so seeding them keeps every environment spelled the same. They are ordinary
-- permissions: administrators may rename, describe or delete them, and choose at runtime
-- which roles grant them. No role grant is seeded; Master Admin covers them through its
-- wildcard. Permissions an administrator already created by hand are left untouched.
INSERT INTO "permission" ("id", "key", "name", "description", "managed") VALUES
	('migration-permission-admin-access', 'admin:access', 'Open the admin dashboard', 'Sign in to the PoliNetwork admin dashboard.', false),
	('migration-permission-tg-moderate', 'tg:moderate', 'Moderate Telegram chats', 'Ban, kick, mute and unban in any network chat, including from the report menu.', false),
	('migration-permission-tg-moderate-global', 'tg:moderate:global', 'Ban across the network', 'Start ban-all and unban-all, and confirm or release campaign reviews.', false),
	('migration-permission-tg-messages-delete', 'tg:messages:delete', 'Delete Telegram messages', 'Delete messages with /del or from the report menu.', false),
	('migration-permission-tg-messages-pin', 'tg:messages:pin', 'Pin Telegram messages', 'Pin and unpin messages.', false),
	('migration-permission-tg-immune', 'tg:immune', 'Immune on Telegram', 'Never targeted by ban-all and exempt from campaign-spam checks. Also grants trusted status.', false),
	('migration-permission-tg-trusted', 'tg:trusted', 'Trusted on Telegram', 'Skips automatic moderation and hashtag rules.', false),
	('migration-permission-tg-audit-read', 'tg:audit:read', 'Read the Telegram audit log', 'Use /audit and see audit history in the dashboard.', false),
	('migration-permission-tg-users-read', 'tg:users:read', 'View Telegram users', 'See the Telegram user list and details, and use /userid.', false),
	('migration-permission-tg-messages-read', 'tg:messages:read', 'Read stored Telegram messages', 'Read stored, decrypted messages in the dashboard.', false),
	('migration-permission-tg-groups-manage', 'tg:groups:manage', 'Manage Telegram groups', 'Update groups, regenerate invite links, and hide or leave a group.', false),
	('migration-permission-tg-bot-add', 'tg:bot:add', 'Add the bot to groups', 'Add the PoliNetwork bot to a Telegram group.', false),
	('migration-permission-tg-grants-read', 'tg:grants:read', 'View Telegram grants', 'See temporary trust granted to Telegram users.', false),
	('migration-permission-tg-grants-manage', 'tg:grants:manage', 'Manage Telegram grants', 'Create and interrupt temporary trust for Telegram users.', false),
	('migration-permission-wa-groups-manage', 'wa:groups:manage', 'Manage WhatsApp groups', 'Create, change and delete WhatsApp groups.', false),
	('migration-permission-groups-labels-write', 'groups:labels:write', 'Manage group labels', 'Create, change and delete group labels, and tag groups with them.', false),
	('migration-permission-web-content-write', 'web:content:write', 'Edit website content', 'Edit associations, FAQs, projects and freshman guides.', false),
	('migration-permission-web-reports-manage', 'web:reports:manage', 'Handle group-link reports', 'Resolve or dismiss reports about group links.', false),
	('migration-permission-azure-members-create', 'azure:members:create', 'Create a socio', 'Create a new Entra user and add only that user to the Soci group.', false)
ON CONFLICT ("key") DO NOTHING;--> statement-breakpoint
-- Immunity implies trust (RFC §4.1).
INSERT INTO "permission_implication" ("permission_id", "implied_permission_id")
SELECT immune.id, trusted.id
FROM "permission" immune
JOIN "permission" trusted ON trusted.key = 'tg:trusted'
WHERE immune.key = 'tg:immune'
ON CONFLICT DO NOTHING;
