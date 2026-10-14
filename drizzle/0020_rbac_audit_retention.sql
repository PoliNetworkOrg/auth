-- The privacy policy keeps the administrative audit log for five years, then deletes it.
-- Updates and truncation stay rejected. A delete is checked row by row and refused, together
-- with the whole statement, if any row it touches is not yet five years old, so nothing can
-- remove an event that is still within its retention period. `now()` is the transaction's
-- start time, which can only move the cutoff earlier. The search path is pinned so a caller
-- cannot substitute its own `now()` or comparison operators.
DROP TRIGGER rbac_audit_append_only ON rbac_audit_event;
--> statement-breakpoint
CREATE TRIGGER rbac_audit_append_only BEFORE UPDATE OR TRUNCATE ON rbac_audit_event
FOR EACH STATEMENT EXECUTE FUNCTION reject_rbac_audit_mutation();
--> statement-breakpoint
CREATE FUNCTION reject_retained_rbac_audit_delete() RETURNS trigger LANGUAGE plpgsql
SET search_path = pg_catalog AS $$
BEGIN
  IF OLD."createdAt" >= now() - interval '5 years' THEN
    RAISE EXCEPTION 'RBAC audit events are append-only until they are five years old';
  END IF;
  RETURN OLD;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER rbac_audit_retention BEFORE DELETE ON rbac_audit_event
FOR EACH ROW EXECUTE FUNCTION reject_retained_rbac_audit_delete();
