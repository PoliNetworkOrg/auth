import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { cn } from "cn";
import { Info, LoaderCircle, Lock } from "lucide-react";
import {
  hasDraftErrors,
  MAX_CLIENT_NAME_LENGTH,
  normalizeClientDraft,
  type OidcClientCredential,
  type OidcClientDraft,
  type OidcClientDraftErrors,
  validateClientDraft,
} from "@/auth/oidc-clients";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  ApiAccessTable,
  credentialChangeNote,
  credentialInfo,
  FieldError,
  IdentityScopeList,
  JwksField,
  ListField,
  RedirectRule,
  SwitchRow,
  TextField,
} from "./form-fields";
import { useClientDraft, withDerivedResources } from "./use-client-draft";

type ApplicationSettingsFormProps = {
  initial: OidcClientDraft;
  /** The credential the client uses now, to explain what switching does. */
  savedCredential: OidcClientCredential;
  /** Whether this deployment has API resources to grant. */
  apiAccess: boolean;
  /** Whether the person may grant API scopes and service access. */
  canGrantApiAccess: boolean;
  /** Shows the registered settings without offering controls that will be rejected. */
  readOnly: boolean;
  busy: boolean;
  /** Change after a save to reload `initial` in place, without remounting the form. */
  resetKey: number;
  serverErrors?: OidcClientDraftErrors;
  /** Settings that save on their own, shown at the end of the Sign-in section. */
  signInExtras?: ReactNode;
  onSubmit: (draft: OidcClientDraft) => void;
};

const credentials: OidcClientCredential[] = ["secret", "private-key", "public"];

function snapshot(draft: OidcClientDraft) {
  return JSON.stringify(normalizeClientDraft(withDerivedResources(draft)));
}

function scrollToFirstError(form: HTMLFormElement) {
  const target = form.querySelector<HTMLElement>('[aria-invalid="true"], [role="alert"]');
  if (!target) return;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  target.scrollIntoView({ block: "center", behavior: reduce ? "auto" : "smooth" });
  if (target.matches("input, textarea")) target.focus({ preventScroll: true });
}

/** A titled card the page's section nav links to, by its `id`. */
export function SettingsSection({
  id,
  title,
  children,
  className,
}: {
  id: string;
  title: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      id={id}
      data-nav-section={title}
      aria-labelledby={`${id}-title`}
      className="scroll-mt-24 space-y-3"
    >
      <h2 id={`${id}-title`} className="text-base font-semibold tracking-tight">
        {title}
      </h2>
      <Card className={className}>{children}</Card>
    </section>
  );
}

function CredentialChoice({
  value,
  onChange,
  publicDisabled,
}: {
  value: OidcClientCredential;
  onChange: (value: OidcClientCredential) => void;
  publicDisabled: boolean;
}) {
  const id = useId();
  return (
    <div className="space-y-3">
      <p id={`${id}-label`} className="text-sm leading-none font-medium">
        Credential
      </p>
      {/* Native radios keep arrow-key navigation and form semantics for free. */}
      <div
        role="radiogroup"
        aria-labelledby={`${id}-label`}
        aria-describedby={`${id}-description`}
        className="grid grid-cols-3 gap-1 rounded-lg border bg-muted/50 p-1"
      >
        {credentials.map((credential) => {
          const disabled = credential === "public" && publicDisabled;
          return (
            <label
              key={credential}
              className={cn(
                "flex min-h-10 items-center justify-center rounded-md px-2 py-1 text-center text-sm leading-tight font-medium transition-colors has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/50",
                value === credential
                  ? "bg-background text-foreground shadow-sm ring-1 ring-border dark:bg-input/60"
                  : "text-muted-foreground",
                disabled
                  ? "cursor-not-allowed opacity-50"
                  : value !== credential && "cursor-pointer hover:text-foreground",
              )}
            >
              <input
                type="radio"
                name={id}
                value={credential}
                checked={value === credential}
                disabled={disabled}
                className="sr-only"
                onChange={() => onChange(credential)}
              />
              {credentialInfo[credential].title}
            </label>
          );
        })}
      </div>
      <p id={`${id}-description`} className="text-xs leading-5 text-muted-foreground">
        {credentialInfo[value].description}
        {publicDisabled && " Public isn't available while the app calls APIs as itself."}
      </p>
    </div>
  );
}

export function ApplicationSettingsForm({
  initial,
  savedCredential,
  apiAccess,
  canGrantApiAccess,
  readOnly,
  busy,
  resetKey,
  serverErrors,
  signInExtras,
  onSubmit,
}: ApplicationSettingsFormProps) {
  const id = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const api = useClientDraft(initial);
  const { draft, update } = api;
  const [attempted, setAttempted] = useState(false);
  const [failedAttempts, setFailedAttempts] = useState(0);
  // Discarding hides the last save's server errors until the next save reports new ones.
  const [dismissedErrors, setDismissedErrors] = useState<OidcClientDraftErrors>();
  // Picks up the saved values while keeping focus and scroll position.
  const [loadedResetKey, setLoadedResetKey] = useState(resetKey);
  if (resetKey !== loadedResetKey) {
    setLoadedResetKey(resetKey);
    api.reset(initial);
    setAttempted(false);
  }

  const activeServerErrors = serverErrors !== dismissedErrors ? serverErrors : undefined;
  const localErrors = attempted ? validateClientDraft(draft, { apiAccess }) : {};
  const errors: OidcClientDraftErrors = { ...activeServerErrors, ...localErrors };
  const invalid = hasDraftErrors(errors);
  const dirty = snapshot(draft) !== snapshot(initial);
  const showSaveBar = !readOnly && (dirty || (attempted && invalid) || busy);

  useEffect(() => {
    if (failedAttempts && formRef.current) scrollToFirstError(formRef.current);
  }, [failedAttempts]);
  useEffect(() => {
    if (serverErrors && hasDraftErrors(serverErrors) && formRef.current)
      scrollToFirstError(formRef.current);
  }, [serverErrors]);

  const serviceAccessDisabled =
    !canGrantApiAccess || (!draft.serviceAccess && (!apiAccess || draft.credential === "public"));
  const serviceAccessDescription = !canGrantApiAccess
    ? "Obtains tokens with its own credential, with nobody signed in. Only Master Admin can change this."
    : !apiAccess && !draft.serviceAccess
      ? "Obtains tokens with its own credential, with nobody signed in. API access isn't configured on this server."
      : draft.credential === "public" && !draft.serviceAccess
        ? "Obtains tokens with its own credential, with nobody signed in. Needs a client secret or private key."
        : "Obtains tokens with its own credential, with nobody signed in. For bots and backend jobs.";
  const credentialNote = credentialChangeNote(savedCredential, draft.credential);
  const apiLocked = !canGrantApiAccess;
  const showApiAccess =
    (draft.signIn || draft.serviceAccess) &&
    (apiAccess || draft.serviceAccess || draft.apiScopes.length > 0);

  return (
    <form
      ref={formRef}
      noValidate
      aria-label="Application settings"
      className="space-y-8"
      onSubmit={(event) => {
        event.preventDefault();
        if (readOnly || busy) return;
        setAttempted(true);
        if (hasDraftErrors(validateClientDraft(draft, { apiAccess }))) {
          setFailedAttempts((count) => count + 1);
          return;
        }
        onSubmit(draft);
      }}
    >
      {readOnly && (
        <p className="flex items-center gap-2 rounded-xl border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
          <Lock className="size-4 shrink-0" aria-hidden="true" />
          This application has API access, so only Master Admin can change it.
        </p>
      )}

      <fieldset disabled={readOnly} className="min-w-0 space-y-8 border-0 p-0">
        <SettingsSection id="general" title="General">
          <div className="space-y-5 p-6">
            <TextField
              label="Application name"
              required
              inputMode="text"
              maxLength={MAX_CLIENT_NAME_LENGTH}
              value={draft.name}
              error={errors.name}
              onChange={(value) => update("name", value)}
            />
            <TextField
              label="Logo URL"
              placeholder="https://app.polinetwork.org/logo.png"
              value={draft.logo}
              error={errors.logo}
              onChange={(value) => update("logo", value)}
            />
            <TextField
              label="Homepage URL"
              placeholder="https://app.polinetwork.org"
              value={draft.uri}
              error={errors.uri}
              onChange={(value) => update("uri", value)}
            />
          </div>
        </SettingsSection>

        <SettingsSection id="connection" title="Connection">
          <div className="divide-y">
            <div className="px-6 py-5">
              <SwitchRow
                title="Signs people in"
                description="People sign in with their PoliNetwork account and the app learns who they are."
                checked={draft.signIn}
                onCheckedChange={(checked) => update("signIn", checked)}
              />
            </div>
            <div className="px-6 py-5">
              <SwitchRow
                title="Calls APIs as itself"
                description={serviceAccessDescription}
                checked={draft.serviceAccess}
                disabled={serviceAccessDisabled}
                onCheckedChange={(checked) => update("serviceAccess", checked)}
              />
              {errors.grants && (
                <div className="mt-3">
                  <FieldError>{errors.grants}</FieldError>
                </div>
              )}
            </div>
            <div className="space-y-5 px-6 py-5">
              <CredentialChoice
                value={draft.credential}
                publicDisabled={draft.serviceAccess}
                onChange={api.setCredential}
              />
              {credentialNote && (
                <p
                  role="status"
                  className="flex items-start gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-xs leading-5"
                >
                  <Info className="mt-0.5 size-3.5 shrink-0 text-primary" aria-hidden="true" />
                  {credentialNote}
                </p>
              )}
              <FieldError>{errors.credential}</FieldError>
              {draft.credential === "private-key" && (
                <JwksField
                  value={draft.jwks}
                  error={errors.jwks}
                  onChange={(value) => update("jwks", value)}
                />
              )}
            </div>
          </div>
        </SettingsSection>

        {draft.signIn && (
          <SettingsSection id="sign-in" title="Sign-in">
            <div className="space-y-8 p-6">
              <ListField
                label="Redirect URIs"
                required
                minItems={1}
                items={draft.redirectUris}
                error={errors.redirectUris}
                itemErrors={errors.redirectUriItems}
                placeholder="https://app.polinetwork.org/auth/callback"
                addLabel="Add redirect URI"
                onChange={(items) => update("redirectUris", items)}
              />
              <RedirectRule
                compact
                value={draft.applicationType}
                onChange={(value) => update("applicationType", value)}
              />
              <div className="space-y-2">
                <IdentityScopeList dense api={api} legend="What it may ask people for" />
                <FieldError>{errors.scopes}</FieldError>
              </div>
              <div className="space-y-3">
                <ListField
                  label="Post-logout redirect URIs"
                  items={draft.postLogoutRedirectUris}
                  itemErrors={errors.postLogoutRedirectUriItems}
                  placeholder="https://app.polinetwork.org/"
                  addLabel="Add post-logout URI"
                  onChange={(items) => update("postLogoutRedirectUris", items)}
                />
                <label
                  htmlFor={`${id}-end-session`}
                  className="-mx-2 flex min-h-10 cursor-pointer items-center gap-3 rounded-md px-2 text-sm hover:bg-accent/40"
                >
                  <Checkbox
                    id={`${id}-end-session`}
                    checked={draft.enableEndSession}
                    onCheckedChange={(checked) => update("enableEndSession", checked === true)}
                  />
                  Signing out of the app also ends the PoliNetwork session
                </label>
              </div>
              {signInExtras}
            </div>
          </SettingsSection>
        )}

        {showApiAccess && (
          <SettingsSection id="api-access" title="API access">
            <div className="p-6">
              <ApiAccessTable api={api} locked={apiLocked} error={errors.apiScopes} />
            </div>
          </SettingsSection>
        )}

        <SettingsSection id="details" title="Details">
          <div className="space-y-5 p-6">
            <ListField
              label="Contact emails"
              type="email"
              items={draft.contacts}
              itemErrors={errors.contactItems}
              placeholder="team@polinetwork.org"
              addLabel="Add contact"
              onChange={(items) => update("contacts", items)}
            />
            <TextField
              label="Privacy policy URL"
              placeholder="https://app.polinetwork.org/privacy"
              value={draft.policyUri}
              error={errors.policyUri}
              onChange={(value) => update("policyUri", value)}
            />
            <TextField
              label="Terms of service URL"
              placeholder="https://app.polinetwork.org/terms"
              value={draft.tosUri}
              error={errors.tosUri}
              onChange={(value) => update("tosUri", value)}
            />
          </div>
        </SettingsSection>
      </fieldset>

      {showSaveBar && (
        <div className="sticky bottom-4 z-10 flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card py-3 pr-3 pl-5 shadow-lg ring-1 shadow-black/20 ring-black/5 duration-200 animate-in fade-in slide-in-from-bottom-2 motion-reduce:animate-none">
          <p
            aria-live="polite"
            className={cn("text-sm font-medium", attempted && invalid && "text-destructive")}
          >
            {attempted && invalid ? "Check the highlighted fields" : "Unsaved changes"}
          </p>
          <div className="ml-auto flex items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              className="h-10"
              disabled={busy}
              onClick={() => {
                api.reset(initial);
                setAttempted(false);
                setDismissedErrors(serverErrors);
              }}
            >
              Discard
            </Button>
            <Button type="submit" className="h-10" disabled={busy}>
              {busy && <LoaderCircle className="animate-spin" aria-hidden="true" />}
              Save changes
            </Button>
          </div>
        </div>
      )}
    </form>
  );
}
