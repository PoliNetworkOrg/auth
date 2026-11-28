-- First and last names stored apart, with where they come from (`src/auth/names.ts`).
ALTER TABLE "user" ADD COLUMN "given_name" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "family_name" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "name_source" text DEFAULT 'self' NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "name_confirmed_at" timestamp;--> statement-breakpoint
ALTER TABLE "identity_evidence" ADD COLUMN "given_name" text;--> statement-breakpoint
ALTER TABLE "identity_evidence" ADD COLUMN "family_name" text;--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_name_source_check" CHECK ("user"."name_source" in ('entra', 'self'));--> statement-breakpoint
-- Backfill. The same best guess as `guessNameParts` in `src/auth/names.ts`: the last word is the
-- family name, with the particles before it ("De Luca", "van der Berg"); a single word is a
-- given name alone. Everyone becomes `self` and unconfirmed, so they confirm it at their next
-- sign-in. People with a PoliNetwork APS account become `entra` instead: the guess stands until
-- their next sign-in reads the directory's names (`syncNames`).
CREATE FUNCTION polinetwork_guess_name_parts(full_name text, OUT given text, OUT family text)
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  words text[] := regexp_split_to_array(btrim(regexp_replace(full_name, '\s+', ' ', 'g')), ' ');
  total integer;
  start integer;
BEGIN
  IF btrim(full_name) = '' THEN
    given := '';
    family := '';
    RETURN;
  END IF;
  total := array_length(words, 1);
  IF total = 1 THEN
    given := words[1];
    family := '';
    RETURN;
  END IF;
  start := total;
  WHILE start > 2 AND lower(words[start - 1]) = ANY (ARRAY[
    'da', 'dal', 'dalla', 'dalle', 'dai', 'das', 'de', 'dei', 'degli', 'del', 'della', 'delle',
    'dello', 'der', 'des', 'di', 'do', 'dos', 'du', 'la', 'le', 'lo', 'van', 'von'
  ]) LOOP
    start := start - 1;
  END LOOP;
  given := array_to_string(words[1:start - 1], ' ');
  family := array_to_string(words[start:total], ' ');
END;
$$;--> statement-breakpoint
UPDATE "user" SET "given_name" = guess.given, "family_name" = guess.family
FROM (SELECT "id", (polinetwork_guess_name_parts("name")).* FROM "user") AS guess
WHERE guess."id" = "user"."id";--> statement-breakpoint
UPDATE "user" SET "name_source" = 'entra', "name_confirmed_at" = now()
WHERE EXISTS (
  SELECT 1 FROM "account" WHERE "account"."user_id" = "user"."id" AND "account"."provider_id" = 'pn-entra'
);--> statement-breakpoint
DROP FUNCTION polinetwork_guess_name_parts(text);
