import { useId, useState, type ReactNode } from "react";
import { cn } from "cn";
import {
  ChevronRight,
  Globe,
  KeyRound,
  LoaderCircle,
  Lock,
  LogIn,
  Plus,
  Server,
  Smartphone,
  Trash2,
  Unlock,
} from "lucide-react";
import {
  activeApiScopes,
  apiScopes,
  hasDraftErrors,
  MAX_CLIENT_NAME_LENGTH,
  type OidcClientCredential,
  type OidcClientDraft,
  type OidcClientDraftErrors,
  oidcResources,
  oidcScopes,
  validateClientDraft,
} from "@/auth/oidc-clients";
import { AppLogo } from "@/components/oidc/app-logo";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type ScopeList = "apiScopes" | "serviceScopes";

function scopeResource(scopeId: string) {
  return apiScopes.find((scope) => scope.id === scopeId)?.resource;
}

type ClientFormProps = {
  mode: "create" | "edit";
  initial: OidcClientDraft;
  /** The credential the client uses now, to explain what switching does. */
  savedCredential?: OidcClientCredential;
  /** Whether this deployment has API resources to grant. */
  apiAccess: boolean;
  /** Whether the person may grant API scopes, service access, and resources. */
  canGrantApiAccess: boolean;
  /** Shows the registered settings without offering controls that will be rejected. */
  readOnly?: boolean;
  busy: boolean;
  /** Change after a save to reload `initial` in place, without remounting the form. */
  resetKey?: number;
  serverErrors?: OidcClientDraftErrors;
  submitLabel: string;
  onSubmit: (draft: OidcClientDraft) => void;
  onCancel?: () => void;
};

function Field({
  id,
  label,
  hint,
  error,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-xs leading-5 text-destructive">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-xs leading-5 text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

function ChoiceCard({
  checked,
  onSelect,
  icon,
  title,
  description,
  disabled,
  role = "radio",
}: {
  checked: boolean;
  onSelect: () => void;
  icon: ReactNode;
  title: string;
  description: string;
  disabled?: boolean;
  role?: "radio" | "checkbox";
}) {
  return (
    <button
      type="button"
      role={role}
      aria-checked={checked}
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        "flex items-start gap-3 rounded-xl border p-4 text-left transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-60",
        checked ? "border-primary bg-primary/5" : "enabled:hover:bg-accent/60",
      )}
    >
      <span
        className={cn(
          "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg",
          checked ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
        )}
        aria-hidden="true"
      >
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold">{title}</span>
        <span className="mt-1 block text-xs leading-5 text-muted-foreground">{description}</span>
      </span>
    </button>
  );
}

function UriList({
  id,
  label,
  items,
  itemErrors,
  error,
  placeholder,
  addLabel,
  hint,
  minItems = 0,
  onChange,
  type = "url",
}: {
  id: string;
  label: string;
  items: string[];
  itemErrors?: (string | null)[];
  error?: string;
  placeholder: string;
  addLabel: string;
  hint?: string;
  minItems?: number;
  onChange: (items: string[]) => void;
  type?: "url" | "email";
}) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">{label}</legend>
      {hint && <p className="text-xs leading-5 text-muted-foreground">{hint}</p>}
      <div className="space-y-2">
        {items.map((item, index) => {
          const itemError = itemErrors?.[index] ?? undefined;
          const inputId = `${id}-${index}`;
          return (
            <div key={inputId} className="space-y-1">
              <div className="flex items-center gap-2">
                <Input
                  id={inputId}
                  type={type === "email" ? "email" : "text"}
                  inputMode={type === "email" ? "email" : "url"}
                  autoComplete="off"
                  spellCheck={false}
                  aria-label={`${label} ${index + 1}`}
                  aria-invalid={!!itemError}
                  aria-describedby={itemError ? `${inputId}-error` : undefined}
                  placeholder={placeholder}
                  value={item}
                  className="font-mono text-sm"
                  onChange={(event) =>
                    onChange(items.map((value, i) => (i === index ? event.target.value : value)))
                  }
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Remove ${label.toLowerCase()} ${index + 1}`}
                  disabled={items.length <= minItems}
                  onClick={() => onChange(items.filter((_, i) => i !== index))}
                >
                  <Trash2 aria-hidden="true" />
                </Button>
              </div>
              {itemError && (
                <p
                  id={`${inputId}-error`}
                  role="alert"
                  className="text-xs leading-5 text-destructive"
                >
                  {itemError}
                </p>
              )}
            </div>
          );
        })}
      </div>
      {error && (
        <p role="alert" className="text-xs leading-5 text-destructive">
          {error}
        </p>
      )}
      <Button type="button" variant="outline" size="sm" onClick={() => onChange([...items, ""])}>
        <Plus aria-hidden="true" />
        {addLabel}
      </Button>
    </fieldset>
  );
}

function SectionHeading({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <div>
      <h3 id={id} className="text-base font-semibold">
        {title}
      </h3>
      <p className="mt-1 text-sm text-muted-foreground">{children}</p>
    </div>
  );
}

function FieldError({ children }: { children?: string }) {
  if (!children) return null;
  return (
    <p role="alert" className="text-xs leading-5 text-destructive">
      {children}
    </p>
  );
}

const credentialChoices: {
  id: OidcClientCredential;
  icon: ReactNode;
  title: string;
  description: string;
}[] = [
  {
    id: "secret",
    icon: <Lock className="size-4" />,
    title: "Client secret",
    description: "A backend keeps a shared secret. Fits server-rendered apps.",
  },
  {
    id: "private-key",
    icon: <KeyRound className="size-4" />,
    title: "Private key",
    description: "Signs its requests with its own key; you register the public JWKS.",
  },
  {
    id: "public",
    icon: <Unlock className="size-4" />,
    title: "Public",
    description: "Runs in the browser or on a device. No secret; PKCE is required.",
  },
];

/** What saving does to the credentials the app uses now. */
function credentialChangeNote(from: OidcClientCredential, to: OidcClientCredential) {
  if (from === to) return null;
  if (to === "secret") return "A new client secret is issued when you save. It is shown once.";
  if (to === "private-key")
    return "The current secret stops working when you save. The app must sign with its key.";
  return from === "secret"
    ? "The current secret stops working when you save. The app must use PKCE."
    : "The registered keys stop working when you save. The app must use PKCE.";
}

export function ClientForm({
  mode,
  initial,
  savedCredential,
  apiAccess,
  canGrantApiAccess,
  readOnly = false,
  busy,
  resetKey,
  serverErrors,
  submitLabel,
  onSubmit,
  onCancel,
}: ClientFormProps) {
  const id = useId();
  const [draft, setDraft] = useState<OidcClientDraft>(initial);
  const [attempted, setAttempted] = useState(false);
  // Picks up the saved values while keeping focus and the open Advanced section.
  const [loadedResetKey, setLoadedResetKey] = useState(resetKey);
  if (resetKey !== loadedResetKey) {
    setLoadedResetKey(resetKey);
    setDraft(initial);
    setAttempted(false);
  }
  const localErrors = attempted ? validateClientDraft(draft, { apiAccess }) : {};
  const errors: OidcClientDraftErrors = { ...serverErrors, ...localErrors };
  const showSummary = attempted && hasDraftErrors(errors);
  const apiLocked = readOnly || !canGrantApiAccess;

  function update<K extends keyof OidcClientDraft>(key: K, value: OidcClientDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }
  function setCredential(credential: OidcClientCredential) {
    // Public clients cannot authenticate, so they cannot obtain tokens as themselves.
    setDraft((current) => ({
      ...current,
      credential,
      ...(credential === "public" ? { serviceAccess: false, signIn: true } : {}),
    }));
  }
  function toggleScope(scopeId: string, checked: boolean) {
    update(
      "scopes",
      checked ? [...draft.scopes, scopeId] : draft.scopes.filter((scope) => scope !== scopeId),
    );
  }
  function toggleApiScope(list: ScopeList, scopeId: string, checked: boolean) {
    const resource = apiScopes.find((scope) => scope.id === scopeId)?.resource;
    setDraft((current) => ({
      ...current,
      [list]: checked
        ? [...current[list], scopeId]
        : current[list].filter((scope) => scope !== scopeId),
      // A scope is only usable on a token addressed to its resource.
      resources:
        checked && resource && !current.resources.includes(resource)
          ? [...current.resources, resource]
          : current.resources,
    }));
  }
  function toggleResource(resourceId: (typeof oidcResources)[number]["id"], checked: boolean) {
    setDraft((current) => ({
      ...current,
      resources: checked
        ? [...current.resources, resourceId]
        : current.resources.filter((resource) => resource !== resourceId),
      ...(checked
        ? {}
        : {
            apiScopes: current.apiScopes.filter((scope) => scopeResource(scope) !== resourceId),
            serviceScopes: current.serviceScopes.filter(
              (scope) => scopeResource(scope) !== resourceId,
            ),
          }),
    }));
  }

  const redirectHint =
    draft.applicationType === "web"
      ? "Exact https URLs on a public host. Web apps cannot use localhost; choose Native or local for local development."
      : "Exact URLs. Native apps may use http://localhost, http://127.0.0.1, http://[::1], or a reverse-domain scheme such as org.polinetwork.app:/callback.";
  const credentialNote =
    mode === "edit" && savedCredential
      ? credentialChangeNote(savedCredential, draft.credential)
      : null;
  const showGrants = apiAccess || draft.serviceAccess;
  const selectedApiScopes = activeApiScopes(draft);
  const apiInUse =
    draft.serviceAccess || selectedApiScopes.length > 0 || draft.resources.length > 0;
  // With both flows the two ceilings are chosen separately; otherwise only the active one.
  const scopeLists: { list: ScopeList; label: string }[] =
    draft.signIn && draft.serviceAccess
      ? [
          { list: "apiScopes", label: "People" },
          { list: "serviceScopes", label: "Itself" },
        ]
      : [{ list: draft.signIn ? "apiScopes" : "serviceScopes", label: "" }];
  const showApiAccess = apiAccess || apiInUse;

  return (
    <form
      noValidate
      className="space-y-10"
      onSubmit={(event) => {
        event.preventDefault();
        setAttempted(true);
        if (hasDraftErrors(validateClientDraft(draft, { apiAccess }))) return;
        onSubmit(draft);
      }}
    >
      <section className="space-y-5" aria-labelledby={`${id}-basics`}>
        <SectionHeading id={`${id}-basics`} title="Basics">
          What people see on the sign-in and consent screens.
        </SectionHeading>
        <div className="flex flex-wrap items-start gap-5">
          <AppLogo name={draft.name || "New app"} logo={draft.logo} className="size-16 text-lg" />
          <div className="min-w-0 flex-1 basis-64 space-y-5">
            <Field id={`${id}-name`} label="Application name" error={errors.name}>
              <Input
                id={`${id}-name`}
                value={draft.name}
                maxLength={MAX_CLIENT_NAME_LENGTH}
                autoComplete="off"
                placeholder="PoliNetwork Wiki"
                aria-invalid={!!errors.name}
                aria-describedby={errors.name ? `${id}-name-error` : undefined}
                onChange={(event) => update("name", event.target.value)}
              />
            </Field>
            <Field
              id={`${id}-uri`}
              label="Homepage URL"
              hint="Optional. Shown as a link so people can recognize the app."
              error={errors.uri}
            >
              <Input
                id={`${id}-uri`}
                inputMode="url"
                autoComplete="off"
                spellCheck={false}
                placeholder="https://app.polinetwork.org"
                value={draft.uri}
                aria-invalid={!!errors.uri}
                aria-describedby={errors.uri ? `${id}-uri-error` : `${id}-uri-hint`}
                onChange={(event) => update("uri", event.target.value)}
              />
            </Field>
            <Field
              id={`${id}-logo`}
              label="Logo URL"
              hint="Optional. A square https image works best."
              error={errors.logo}
            >
              <Input
                id={`${id}-logo`}
                inputMode="url"
                autoComplete="off"
                spellCheck={false}
                placeholder="https://app.polinetwork.org/icon.png"
                value={draft.logo}
                aria-invalid={!!errors.logo}
                aria-describedby={errors.logo ? `${id}-logo-error` : `${id}-logo-hint`}
                onChange={(event) => update("logo", event.target.value)}
              />
            </Field>
          </div>
        </div>
      </section>

      <section className="space-y-5" aria-labelledby={`${id}-type`}>
        <SectionHeading id={`${id}-type`} title="Application type">
          {draft.signIn
            ? "Decides which redirect URIs are allowed and how the app proves who it is."
            : "Decides how the app proves who it is."}
        </SectionHeading>
        {draft.signIn && (
          <div className="space-y-2">
            <p id={`${id}-platform`} className="text-sm font-medium">
              Platform
            </p>
            <div
              role="radiogroup"
              aria-labelledby={`${id}-platform`}
              className="grid gap-3 sm:grid-cols-2"
            >
              <ChoiceCard
                checked={draft.applicationType === "web"}
                onSelect={() => update("applicationType", "web")}
                icon={<Globe className="size-4" />}
                title="Web"
                description="Websites and web apps served over https."
              />
              <ChoiceCard
                checked={draft.applicationType === "native"}
                onSelect={() => update("applicationType", "native")}
                icon={<Smartphone className="size-4" />}
                title="Native or local"
                description="Mobile, desktop, CLI tools, and local development on localhost."
              />
            </div>
          </div>
        )}
        <div className="space-y-2">
          <p id={`${id}-credential`} className="text-sm font-medium">
            Credentials
          </p>
          <div
            role="radiogroup"
            aria-labelledby={`${id}-credential`}
            className="grid gap-3 sm:grid-cols-3"
          >
            {credentialChoices.map((choice) => (
              <ChoiceCard
                key={choice.id}
                checked={draft.credential === choice.id}
                onSelect={() => setCredential(choice.id)}
                icon={choice.icon}
                title={choice.title}
                description={choice.description}
              />
            ))}
          </div>
          {credentialNote && (
            <p role="status" className="text-xs leading-5 text-muted-foreground">
              {credentialNote}
            </p>
          )}
        </div>
        {draft.credential === "private-key" && (
          <Field
            id={`${id}-jwks`}
            label="Public JWKS"
            hint="Ed25519 or P-256 public keys, up to five. To rotate, add the new key, deploy its private key, then remove the old one."
            error={errors.jwks}
          >
            <Textarea
              id={`${id}-jwks`}
              rows={8}
              spellCheck={false}
              autoComplete="off"
              className="max-h-80 font-mono text-xs md:text-xs"
              placeholder={'{"keys":[{"kty":"OKP","crv":"Ed25519","x":"…","kid":"…"}]}'}
              value={draft.jwks}
              aria-invalid={!!errors.jwks}
              aria-describedby={errors.jwks ? `${id}-jwks-error` : `${id}-jwks-hint`}
              onChange={(event) => update("jwks", event.target.value)}
            />
          </Field>
        )}
      </section>

      {showGrants && (
        <section className="space-y-5" aria-labelledby={`${id}-grants`}>
          <SectionHeading id={`${id}-grants`} title="Tokens">
            How the application obtains tokens. Choose one or both.
          </SectionHeading>
          <div className="grid gap-3 sm:grid-cols-2">
            <ChoiceCard
              role="checkbox"
              checked={draft.signIn}
              onSelect={() => update("signIn", !draft.signIn)}
              icon={<LogIn className="size-4" />}
              title="Signs people in"
              description="Authorization code with PKCE. People review its access on a consent screen."
            />
            <ChoiceCard
              role="checkbox"
              checked={draft.serviceAccess}
              disabled={apiLocked || draft.credential === "public"}
              onSelect={() => update("serviceAccess", !draft.serviceAccess)}
              icon={<Server className="size-4" />}
              title="Acts as itself"
              description={
                draft.credential === "public"
                  ? "Needs a client secret or a private key."
                  : "Client credentials, for backends and bots calling PoliNetwork APIs."
              }
            />
          </div>
          <FieldError>{errors.grants}</FieldError>
        </section>
      )}

      {draft.signIn && (
        <section className="space-y-5" aria-labelledby={`${id}-redirects`}>
          <SectionHeading id={`${id}-redirects`} title="Redirect URIs">
            Where PoliNetwork sends people back after they sign in. Must match exactly.
          </SectionHeading>
          <UriList
            id={`${id}-redirect`}
            label="Redirect URIs"
            items={draft.redirectUris}
            itemErrors={errors.redirectUriItems}
            error={errors.redirectUris}
            hint={redirectHint}
            placeholder={
              draft.applicationType === "web"
                ? "https://app.polinetwork.org/auth/callback"
                : "http://localhost:3000/auth/callback"
            }
            addLabel="Add redirect URI"
            minItems={1}
            onChange={(items) => update("redirectUris", items)}
          />
        </section>
      )}

      {draft.signIn && (
        <section className="space-y-5" aria-labelledby={`${id}-scopes`}>
          <SectionHeading id={`${id}-scopes`} title="Permissions">
            The most this app may request. People still review each request on the consent screen.
          </SectionHeading>
          <ul className="divide-y rounded-xl border">
            {oidcScopes.map((scope) => {
              const checked = scope.required || draft.scopes.includes(scope.id);
              const checkboxId = `${id}-scope-${scope.id}`;
              return (
                <li key={scope.id} className="flex items-start gap-3 p-4">
                  <Checkbox
                    id={checkboxId}
                    checked={checked}
                    disabled={scope.required}
                    className="mt-0.5"
                    onCheckedChange={(value) => toggleScope(scope.id, value === true)}
                  />
                  <div className="min-w-0 flex-1">
                    <Label htmlFor={checkboxId} className="cursor-pointer">
                      {scope.label}
                      <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] font-normal text-muted-foreground">
                        {scope.id}
                      </code>
                    </Label>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">
                      {scope.description}
                      {scope.required && " Required."}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
          <FieldError>{errors.scopes}</FieldError>
        </section>
      )}

      {showApiAccess && (
        <details
          className="group/api rounded-xl border"
          open={apiInUse || undefined}
          aria-labelledby={`${id}-api`}
        >
          <summary className="flex cursor-pointer list-none items-start gap-2 p-4 marker:content-none">
            <ChevronRight
              className="mt-0.5 size-4 shrink-0 transition-transform group-open/api:rotate-90"
              aria-hidden="true"
            />
            <span>
              <span id={`${id}-api`} className="block text-sm font-semibold">
                API access
                {apiInUse && (
                  <span className="ml-2 font-normal text-muted-foreground">
                    {selectedApiScopes.length} {selectedApiScopes.length === 1 ? "scope" : "scopes"}
                  </span>
                )}
              </span>
              <span className="mt-1 block text-sm text-muted-foreground">
                PoliNetwork APIs the app may call, for the people it signs in or as itself.
                {!canGrantApiAccess && " Only Master Admin can change these."}
              </span>
            </span>
          </summary>
          <div className="space-y-3 border-t p-4 sm:p-5">
            {oidcResources.map((resource) => {
              const resourceId = `${id}-resource-${resource.id}`;
              return (
                <div key={resource.id} className="rounded-xl border">
                  <div className="flex items-start gap-3 p-4">
                    <Checkbox
                      id={resourceId}
                      checked={draft.resources.includes(resource.id)}
                      disabled={apiLocked}
                      className="mt-0.5"
                      onCheckedChange={(value) => toggleResource(resource.id, value === true)}
                    />
                    <div className="min-w-0 flex-1">
                      <Label htmlFor={resourceId} className="cursor-pointer">
                        {resource.label}
                      </Label>
                      <p className="mt-1 text-xs leading-5 text-muted-foreground">
                        {resource.description}
                      </p>
                    </div>
                  </div>
                  <ul className="divide-y border-t bg-muted/30">
                    {apiScopes
                      .filter((scope) => scope.resource === resource.id)
                      .map((scope) => {
                        const checkboxId = `${id}-api-${scope.id}`;
                        const single = scopeLists.length === 1 ? scopeLists[0]! : null;
                        return (
                          <li key={scope.id} className="flex items-start gap-3 py-3 pr-4 pl-11">
                            {single && (
                              <Checkbox
                                id={checkboxId}
                                checked={draft[single.list].includes(scope.id)}
                                disabled={apiLocked}
                                className="mt-0.5"
                                onCheckedChange={(value) =>
                                  toggleApiScope(single.list, scope.id, value === true)
                                }
                              />
                            )}
                            <div className="min-w-0 flex-1">
                              <Label
                                htmlFor={single ? checkboxId : undefined}
                                className={single ? "cursor-pointer" : undefined}
                              >
                                {scope.label}
                                <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] font-normal text-muted-foreground">
                                  {scope.id}
                                </code>
                              </Label>
                              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                                {scope.description}
                              </p>
                            </div>
                            {!single &&
                              scopeLists.map(({ list, label }) => (
                                <div key={list} className="flex items-center gap-1.5 pt-0.5">
                                  <Checkbox
                                    id={`${checkboxId}-${list}`}
                                    checked={draft[list].includes(scope.id)}
                                    disabled={apiLocked}
                                    aria-label={`${scope.label}: ${label === "People" ? "for the people it signs in" : "as itself"}`}
                                    onCheckedChange={(value) =>
                                      toggleApiScope(list, scope.id, value === true)
                                    }
                                  />
                                  <Label
                                    htmlFor={`${checkboxId}-${list}`}
                                    aria-hidden="true"
                                    className="cursor-pointer text-xs font-normal text-muted-foreground"
                                  >
                                    {label}
                                  </Label>
                                </div>
                              ))}
                          </li>
                        );
                      })}
                  </ul>
                </div>
              );
            })}
            <FieldError>{errors.apiScopes}</FieldError>
          </div>
        </details>
      )}

      <details className="group rounded-xl border">
        <summary className="flex cursor-pointer list-none items-center gap-2 p-4 text-sm font-semibold marker:content-none">
          <ChevronRight
            className="size-4 transition-transform group-open:rotate-90"
            aria-hidden="true"
          />
          Advanced
          <span className="font-normal text-muted-foreground">
            {draft.signIn ? "Sign-out, contacts, policies" : "Contacts, policies"}
          </span>
        </summary>
        <div className="space-y-8 border-t p-4 sm:p-5">
          {draft.signIn && (
            <>
              <UriList
                id={`${id}-post-logout`}
                label="Post-logout redirect URIs"
                items={draft.postLogoutRedirectUris}
                itemErrors={errors.postLogoutRedirectUriItems}
                hint="Where people may be sent after signing out of PoliNetwork from this app."
                placeholder="https://app.polinetwork.org/signed-out"
                addLabel="Add post-logout URI"
                onChange={(items) => update("postLogoutRedirectUris", items)}
              />
              <div className="flex items-start gap-3">
                <Checkbox
                  id={`${id}-end-session`}
                  checked={draft.enableEndSession}
                  className="mt-0.5"
                  onCheckedChange={(value) => update("enableEndSession", value === true)}
                />
                <div className="min-w-0 flex-1">
                  <Label htmlFor={`${id}-end-session`} className="cursor-pointer">
                    Let the app sign people out of PoliNetwork
                  </Label>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    Enables RP-initiated logout, so signing out of the app also ends the PoliNetwork
                    session.
                  </p>
                </div>
              </div>
            </>
          )}
          <UriList
            id={`${id}-contacts`}
            label="Contact emails"
            items={draft.contacts}
            itemErrors={errors.contactItems}
            hint="Who to reach about this application."
            placeholder="team@polinetwork.org"
            addLabel="Add contact"
            type="email"
            onChange={(items) => update("contacts", items)}
          />
          <div className="grid gap-5 sm:grid-cols-2">
            <Field id={`${id}-policy`} label="Privacy policy URL" error={errors.policyUri}>
              <Input
                id={`${id}-policy`}
                inputMode="url"
                autoComplete="off"
                spellCheck={false}
                placeholder="https://app.polinetwork.org/privacy"
                value={draft.policyUri}
                aria-invalid={!!errors.policyUri}
                onChange={(event) => update("policyUri", event.target.value)}
              />
            </Field>
            <Field id={`${id}-tos`} label="Terms of service URL" error={errors.tosUri}>
              <Input
                id={`${id}-tos`}
                inputMode="url"
                autoComplete="off"
                spellCheck={false}
                placeholder="https://app.polinetwork.org/terms"
                value={draft.tosUri}
                aria-invalid={!!errors.tosUri}
                onChange={(event) => update("tosUri", event.target.value)}
              />
            </Field>
          </div>
        </div>
      </details>

      {showSummary && (
        <p
          role="alert"
          className="rounded-xl border border-destructive bg-destructive/5 p-4 text-sm"
        >
          Check the highlighted fields before continuing.
        </p>
      )}

      {!readOnly && (
        <div className="flex flex-col-reverse gap-3 border-t pt-6 sm:flex-row sm:justify-end">
          {onCancel && (
            <Button type="button" variant="ghost" disabled={busy} onClick={onCancel}>
              Cancel
            </Button>
          )}
          <Button type="submit" disabled={busy}>
            {busy && <LoaderCircle className="animate-spin" aria-hidden="true" />}
            {submitLabel}
          </Button>
        </div>
      )}
    </form>
  );
}
