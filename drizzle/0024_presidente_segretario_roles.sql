-- A hand-made role already using one of these keys would silently stand in for the board
-- office, keeping its hand assignments. Stop instead, so an administrator renames it first.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "role" WHERE "key" IN ('presidente', 'segretario') AND NOT "managed") THEN
    RAISE EXCEPTION 'Rename the existing presidente or segretario role before migrating: those keys now belong to built-in roles.';
  END IF;
END $$;--> statement-breakpoint
-- The President and Secretary of the board. Like Direttivo, membership follows direct
-- membership of an Entra group (PN_ENTRA_PRESIDENTE_GROUP_ID, PN_ENTRA_SEGRETARIO_GROUP_ID),
-- so the application never writes user_role rows for them.
INSERT INTO "role" ("id", "key", "name", "description", "managed", "source_state") VALUES
	('static-role-presidente', 'presidente', 'Presidente', 'President of the PoliNetwork APS board.', true, 'presidente'),
	('static-role-segretario', 'segretario', 'Segretario', 'Secretary of the PoliNetwork APS board.', true, 'segretario')
ON CONFLICT ("key") DO NOTHING;--> statement-breakpoint
-- Both offices sit on the board, so they always inherit everything Direttivo grants.
INSERT INTO "role_parent" ("role_id", "parent_role_id")
SELECT office.id, board.id
FROM "role" office
JOIN "role" board ON board.key = 'direttivo'
WHERE office.key IN ('presidente', 'segretario')
ON CONFLICT DO NOTHING;
