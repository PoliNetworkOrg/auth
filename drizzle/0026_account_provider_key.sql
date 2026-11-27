-- Better Auth 1.7.3+ finds accounts by (provider_id, account_id). If this fails, two rows share
-- a provider key; find them before migrating with:
--   SELECT provider_id, account_id, count(*) FROM account GROUP BY 1, 2 HAVING count(*) > 1;
CREATE UNIQUE INDEX "account_provider_account_uidx" ON "account" USING btree ("provider_id","account_id");