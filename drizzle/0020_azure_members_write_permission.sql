-- Changing the member number (Entra `employeeId`) of an existing socio returns to the admin
-- dashboard, amending RFC v3 decision 9. The backend's `azure.members.setAssocNumber` checks
-- this key, so seeding it keeps every environment spelled the same. It neither implies nor is
-- implied by `azure:members:read` or `azure:members:create`. No role grant is seeded; Master
-- Admin covers it through its wildcard. A permission an administrator already created by hand
-- is left untouched.
INSERT INTO "permission" ("id", "key", "name", "description", "managed") VALUES
	('migration-permission-azure-members-write', 'azure:members:write', 'Change member numbers', 'Change the member number of an existing Microsoft 365 user and optionally email them the new number. No other user or group changes.', false)
ON CONFLICT ("key") DO NOTHING;
