-- The Telegram @username at the last sign-in, shown next to the ID. Sign-in keeps it current.
ALTER TABLE "identity_evidence" ADD COLUMN "telegram_username" text;--> statement-breakpoint
-- Fill it for existing links from the ID token Telegram last sent, which is already stored on
-- the account. A token that does not decode is skipped; that person gets it at next sign-in.
DO $$
DECLARE
  linked record;
  payload text;
BEGIN
  FOR linked IN
    SELECT "issuer", "account_id", split_part("id_token", '.', 2) AS "part"
    FROM "account"
    WHERE "provider_id" = 'telegram' AND "id_token" IS NOT NULL
  LOOP
    BEGIN
      payload := translate(linked."part", '-_', '+/');
      payload := payload || repeat('=', (4 - length(payload) % 4) % 4);
      UPDATE "identity_evidence"
      SET "telegram_username" = nullif(
        ltrim(convert_from(decode(payload, 'base64'), 'UTF8')::jsonb ->> 'preferred_username', '@'),
        ''
      )
      WHERE "provider_id" = 'telegram'
        AND "issuer" = linked."issuer"
        AND "subject" = linked."account_id";
    EXCEPTION WHEN others THEN
      NULL;
    END;
  END LOOP;
END $$;
