CREATE TABLE "access_outbox" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "access_outbox_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"projection" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE FUNCTION enqueue_access_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'account' THEN
    IF TG_OP = 'INSERT' THEN
      IF NEW.provider_id <> 'telegram' THEN RETURN NEW; END IF;
    ELSIF TG_OP = 'DELETE' THEN
      IF OLD.provider_id <> 'telegram' THEN RETURN OLD; END IF;
    ELSE
      IF NEW.provider_id <> 'telegram' AND OLD.provider_id <> 'telegram' THEN RETURN NEW; END IF;
    END IF;
  END IF;

  IF TG_TABLE_NAME = 'entra_group_observation' THEN
    IF TG_OP = 'UPDATE' THEN
      IF NEW.group_id = OLD.group_id AND NEW.members = OLD.members THEN RETURN NEW; END IF;
    END IF;
  END IF;

  INSERT INTO access_outbox (projection) VALUES ('backend');
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER access_change_user_role AFTER INSERT OR UPDATE OR DELETE ON user_role
  FOR EACH ROW EXECUTE FUNCTION enqueue_access_change();
--> statement-breakpoint
CREATE TRIGGER access_change_role AFTER INSERT OR UPDATE OR DELETE ON role
  FOR EACH ROW EXECUTE FUNCTION enqueue_access_change();
--> statement-breakpoint
CREATE TRIGGER access_change_role_parent AFTER INSERT OR UPDATE OR DELETE ON role_parent
  FOR EACH ROW EXECUTE FUNCTION enqueue_access_change();
--> statement-breakpoint
CREATE TRIGGER access_change_role_permission AFTER INSERT OR UPDATE OR DELETE ON role_permission
  FOR EACH ROW EXECUTE FUNCTION enqueue_access_change();
--> statement-breakpoint
CREATE TRIGGER access_change_permission AFTER INSERT OR UPDATE OR DELETE ON permission
  FOR EACH ROW EXECUTE FUNCTION enqueue_access_change();
--> statement-breakpoint
CREATE TRIGGER access_change_permission_implication AFTER INSERT OR UPDATE OR DELETE ON permission_implication
  FOR EACH ROW EXECUTE FUNCTION enqueue_access_change();
--> statement-breakpoint
CREATE TRIGGER access_change_account AFTER INSERT OR UPDATE OR DELETE ON account
  FOR EACH ROW EXECUTE FUNCTION enqueue_access_change();
--> statement-breakpoint
CREATE TRIGGER access_change_identity_evidence AFTER INSERT OR UPDATE OR DELETE ON identity_evidence
  FOR EACH ROW EXECUTE FUNCTION enqueue_access_change();
--> statement-breakpoint
CREATE TRIGGER access_change_user AFTER DELETE ON "user"
  FOR EACH ROW EXECUTE FUNCTION enqueue_access_change();
--> statement-breakpoint
CREATE TRIGGER access_change_entra_group_observation AFTER INSERT OR UPDATE OR DELETE ON entra_group_observation
  FOR EACH ROW EXECUTE FUNCTION enqueue_access_change();
--> statement-breakpoint
-- Existing keys had no expiry. Give them a full rotation window from deployment.
UPDATE jwks SET expires_at = now() + interval '7 days' WHERE expires_at IS NULL;
--> statement-breakpoint
CREATE FUNCTION audit_identity_change() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  actor text;
  operation text;
  target text;
  before_value jsonb := '{}'::jsonb;
  after_value jsonb := '{}'::jsonb;
BEGIN
  IF TG_TABLE_NAME = 'account' THEN
    IF TG_OP = 'INSERT' THEN
      IF NEW.provider_id <> 'telegram' THEN RETURN NEW; END IF;
      actor := NEW.user_id;
      target := NEW.user_id;
      operation := 'telegram.link';
      after_value := '{"linked":true}'::jsonb;
    ELSE
      IF OLD.provider_id <> 'telegram' THEN RETURN OLD; END IF;
      actor := OLD.user_id;
      target := OLD.user_id;
      operation := 'telegram.unlink';
      before_value := '{"linked":true}'::jsonb;
    END IF;
  ELSE
    actor := 'system';
    IF TG_OP = 'INSERT' THEN
      target := NEW.client_id;
      operation := 'oidc-client.create';
      after_value := jsonb_build_object('disabled', NEW.disabled, 'scopes', NEW.scopes,
        'grantTypes', NEW.grant_types, 'authMethod', NEW.token_endpoint_auth_method,
        'clientCredentialsScopes', NEW.client_credentials_scopes,
        'enableEndSession', NEW.enable_end_session);
    ELSIF TG_OP = 'DELETE' THEN
      target := OLD.client_id;
      operation := 'oidc-client.delete';
      before_value := jsonb_build_object('disabled', OLD.disabled, 'scopes', OLD.scopes,
        'grantTypes', OLD.grant_types, 'authMethod', OLD.token_endpoint_auth_method,
        'clientCredentialsScopes', OLD.client_credentials_scopes,
        'enableEndSession', OLD.enable_end_session);
    ELSE
      target := NEW.client_id;
      operation := 'oidc-client.update';
      before_value := jsonb_build_object('disabled', OLD.disabled, 'scopes', OLD.scopes,
        'grantTypes', OLD.grant_types, 'authMethod', OLD.token_endpoint_auth_method,
        'clientCredentialsScopes', OLD.client_credentials_scopes,
        'enableEndSession', OLD.enable_end_session);
      after_value := jsonb_build_object('disabled', NEW.disabled, 'scopes', NEW.scopes,
        'grantTypes', NEW.grant_types, 'authMethod', NEW.token_endpoint_auth_method,
        'clientCredentialsScopes', NEW.client_credentials_scopes,
        'enableEndSession', NEW.enable_end_session,
        'secretRotated', OLD.client_secret IS DISTINCT FROM NEW.client_secret,
        'jwksChanged', OLD.jwks IS DISTINCT FROM NEW.jwks);
    END IF;
  END IF;

  actor := coalesce(nullif(current_setting('polinetwork.actor_id', true), ''), actor);
  INSERT INTO rbac_audit_event (id, actor_id, operation, target_id, before, after)
    VALUES (gen_random_uuid()::text, actor, operation, target, before_value, after_value);
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER audit_telegram_account AFTER INSERT OR DELETE ON account
  FOR EACH ROW EXECUTE FUNCTION audit_identity_change();
--> statement-breakpoint
CREATE TRIGGER audit_oidc_client AFTER INSERT OR UPDATE OR DELETE ON oauth_client
  FOR EACH ROW EXECUTE FUNCTION audit_identity_change();
--> statement-breakpoint
CREATE FUNCTION audit_oauth_client_resource_change() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  client_id text;
  resource_id text;
  actor text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    client_id := NEW.client_id;
    resource_id := NEW.resource_id;
  ELSE
    client_id := OLD.client_id;
    resource_id := OLD.resource_id;
  END IF;
  actor := coalesce(nullif(current_setting('polinetwork.actor_id', true), ''), 'system');
  INSERT INTO rbac_audit_event (id, actor_id, operation, target_id, before, after)
    VALUES (gen_random_uuid()::text, actor,
      CASE WHEN TG_OP = 'INSERT' THEN 'oidc-client.resource-link' ELSE 'oidc-client.resource-unlink' END,
      client_id,
      CASE WHEN TG_OP = 'DELETE' THEN jsonb_build_object('resource', resource_id) ELSE '{}'::jsonb END,
      CASE WHEN TG_OP = 'INSERT' THEN jsonb_build_object('resource', resource_id) ELSE '{}'::jsonb END);
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER audit_oauth_client_resource AFTER INSERT OR DELETE ON oauth_client_resource
  FOR EACH ROW EXECUTE FUNCTION audit_oauth_client_resource_change();
