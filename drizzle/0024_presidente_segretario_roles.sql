-- A hand-made role already using one of these keys would silently stand in for the board
-- office. Stop instead, so an administrator renames it first.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "role" WHERE "key" IN ('presidente', 'segretario') AND NOT "managed") THEN
    RAISE EXCEPTION 'Rename the existing presidente or segretario role before migrating: those keys now belong to built-in roles.';
  END IF;
END $$;--> statement-breakpoint
-- The President and Secretary of the board. They are built in, but unlike the other
-- built-in roles they are given by hand, and only by a Master Admin, so they have no
-- source_state.
INSERT INTO "role" ("id", "key", "name", "description", "managed", "source_state") VALUES
	('static-role-presidente', 'presidente', 'Presidente', 'President of the PoliNetwork APS board.', true, NULL),
	('static-role-segretario', 'segretario', 'Segretario', 'Secretary of the PoliNetwork APS board.', true, NULL)
ON CONFLICT ("key") DO NOTHING;--> statement-breakpoint
-- Both offices sit on the board, so they always inherit everything Direttivo grants.
INSERT INTO "role_parent" ("role_id", "parent_role_id")
SELECT office.id, board.id
FROM "role" office
JOIN "role" board ON board.key = 'direttivo'
WHERE office.key IN ('presidente', 'segretario')
ON CONFLICT DO NOTHING;--> statement-breakpoint
-- Managed roles still refuse hand-made assignments, except the two board offices.
CREATE OR REPLACE FUNCTION guard_managed_role_links() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'user_role' THEN
    IF EXISTS (
      SELECT 1 FROM role
      WHERE id = NEW.role_id AND managed AND key NOT IN ('presidente', 'segretario')
    ) THEN
      RAISE EXCEPTION 'Managed roles cannot be assigned';
    END IF;
  ELSE
    IF EXISTS (SELECT 1 FROM role WHERE id = NEW.parent_role_id AND key = 'master-admin') THEN
      RAISE EXCEPTION 'Master Admin cannot be inherited';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
