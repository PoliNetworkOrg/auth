CREATE TABLE "rbac_audit_event" (
	"id" text PRIMARY KEY NOT NULL,
	"actor_id" text NOT NULL,
	"operation" text NOT NULL,
	"target_id" text NOT NULL,
	"before" jsonb NOT NULL,
	"after" jsonb NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE FUNCTION reject_rbac_audit_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'RBAC audit events are append-only';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER rbac_audit_append_only BEFORE UPDATE OR DELETE OR TRUNCATE ON rbac_audit_event
FOR EACH STATEMENT EXECUTE FUNCTION reject_rbac_audit_mutation();
--> statement-breakpoint
CREATE FUNCTION guard_managed_role_links() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'user_role' THEN
    IF EXISTS (SELECT 1 FROM role WHERE id = NEW.role_id AND managed) THEN
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
--> statement-breakpoint
CREATE TRIGGER user_role_unmanaged_only BEFORE INSERT OR UPDATE ON user_role
FOR EACH ROW EXECUTE FUNCTION guard_managed_role_links();
--> statement-breakpoint
CREATE TRIGGER role_parent_no_master BEFORE INSERT OR UPDATE ON role_parent
FOR EACH ROW EXECUTE FUNCTION guard_managed_role_links();
--> statement-breakpoint
-- Existing unsafe edges/assignments are quarantined in the audit record before removal.
INSERT INTO rbac_audit_event (id, actor_id, operation, target_id, before, after)
SELECT 'migration-0007-unsafe-links', 'system:migration:0007', 'quarantine', 'managed-role-links',
jsonb_build_object(
  'parents', (SELECT coalesce(jsonb_agg(p), '[]') FROM role_parent p JOIN role r ON r.id = p.parent_role_id WHERE r.key = 'master-admin'),
  'assignments', (SELECT coalesce(jsonb_agg(a), '[]') FROM user_role a JOIN role r ON r.id = a.role_id WHERE r.managed)
), '{}'::jsonb;
--> statement-breakpoint
DELETE FROM role_parent WHERE parent_role_id IN (SELECT id FROM role WHERE key = 'master-admin');
--> statement-breakpoint
DELETE FROM user_role WHERE role_id IN (SELECT id FROM role WHERE managed);
