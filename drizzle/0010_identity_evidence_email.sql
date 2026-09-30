-- The address each PoliNetwork account signs in with. Sign-in fills it, so accounts from
-- before this migration stay empty until that person signs in again.
ALTER TABLE "identity_evidence" ADD COLUMN "email" text;