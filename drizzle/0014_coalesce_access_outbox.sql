-- Every event announces the whole projection, so rows queued before delivery are equivalent.
-- Keep one row per projection; the trigger below stops the queue growing between deliveries.
DELETE FROM access_outbox
WHERE id NOT IN (SELECT min(id) FROM access_outbox GROUP BY projection);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION enqueue_access_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'account' THEN
    IF TG_OP = 'INSERT' THEN
      IF NEW.provider_id <> 'telegram' THEN RETURN NEW; END IF;
    ELSIF TG_OP = 'DELETE' THEN
      IF OLD.provider_id <> 'telegram' THEN RETURN OLD; END IF;
    ELSE
      IF NEW.provider_id <> 'telegram' AND OLD.provider_id <> 'telegram' THEN RETURN NEW; END IF;
      -- Sign-ins refresh the provider tokens on this row; only the link itself is projected.
      IF (NEW.user_id, NEW.provider_id, NEW.issuer, NEW.account_id)
        IS NOT DISTINCT FROM (OLD.user_id, OLD.provider_id, OLD.issuer, OLD.account_id) THEN
        RETURN NEW;
      END IF;
    END IF;
  END IF;

  -- Sign-ins rewrite evidence even when nothing changed.
  IF TG_TABLE_NAME = 'identity_evidence' AND TG_OP = 'UPDATE' THEN
    IF (NEW.issuer, NEW.subject, NEW.provider_id, NEW.external_id, NEW.states, NEW.valid_until,
        NEW.telegram_id)
      IS NOT DISTINCT FROM (OLD.issuer, OLD.subject, OLD.provider_id, OLD.external_id, OLD.states,
        OLD.valid_until, OLD.telegram_id) THEN
      RETURN NEW;
    END IF;
  END IF;

  IF TG_TABLE_NAME = 'entra_group_observation' THEN
    IF TG_OP = 'UPDATE' THEN
      IF NEW.group_id = OLD.group_id AND NEW.members = OLD.members THEN RETURN NEW; END IF;
    END IF;
  END IF;

  -- One undelivered row announces every change made before the dispatcher claims it. The
  -- share lock makes the dispatcher skip that row until this transaction ends, so a change
  -- never relies on an event that may have been sent before it committed.
  PERFORM 1 FROM access_outbox
    WHERE projection = 'backend' AND attempts = 0
    LIMIT 1
    FOR KEY SHARE;
  IF NOT FOUND THEN
    -- Wait behind any delivery already in flight or backing off.
    INSERT INTO access_outbox (projection, next_attempt_at)
      SELECT 'backend', greatest(now(), coalesce(max(next_attempt_at), now()))
      FROM access_outbox
      WHERE projection = 'backend';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
