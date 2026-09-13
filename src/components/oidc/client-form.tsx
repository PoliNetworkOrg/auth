import { useId, useState, type ReactNode } from "react";
import { cn } from "cn";
import {
  ChevronRight,
  Globe,
  LoaderCircle,
  Lock,
  Plus,
  Smartphone,
  Trash2,
  Unlock,
} from "lucide-react";
import {
  hasDraftErrors,
  MAX_CLIENT_NAME_LENGTH,
  type OidcApplicationType,
  type OidcClientDraft,
  type OidcClientDraftErrors,
  oidcScopes,
  validateClientDraft,
} from "@/auth/oidc-clients";
import { AppLogo } from "@/components/oidc/app-logo";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type ClientFormProps = {
  mode: "create" | "edit";
  initial: OidcClientDraft;
  /** Confidential clients receive a secret. Only selectable when creating. */
  confidential?: boolean;
  onConfidentialChange?: (confidential: boolean) => void;
  busy: boolean;
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
}: {
  checked: boolean;
  onSelect: () => void;
  icon: ReactNode;
  title: string;
  description: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        "flex flex-1 items-start gap-3 rounded-xl border p-4 text-left transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-60",
        checked ? "border-primary bg-primary/5" : "hover:bg-accent/60",
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

export function ClientForm({
  mode,
  initial,
  confidential = true,
  onConfidentialChange,
  busy,
  serverErrors,
  submitLabel,
  onSubmit,
  onCancel,
}: ClientFormProps) {
  const id = useId();
  const [draft, setDraft] = useState<OidcClientDraft>(initial);
  const [attempted, setAttempted] = useState(false);
  const localErrors = attempted ? validateClientDraft(draft) : {};
  const errors: OidcClientDraftErrors = { ...serverErrors, ...localErrors };
  const showSummary = attempted && hasDraftErrors(errors);

  function update<K extends keyof OidcClientDraft>(key: K, value: OidcClientDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }
  function setApplicationType(applicationType: OidcApplicationType) {
    update("applicationType", applicationType);
  }
  function toggleScope(scopeId: string, checked: boolean) {
    update(
      "scopes",
      checked ? [...draft.scopes, scopeId] : draft.scopes.filter((scope) => scope !== scopeId),
    );
  }

  const redirectHint =
    draft.applicationType === "web"
      ? "Exact https URLs on a public host. Web apps cannot use localhost; create a native app for local development."
      : "Exact URLs. Native apps may use http://localhost, http://127.0.0.1, http://[::1], or a reverse-domain scheme such as org.polinetwork.app:/callback.";

  return (
    <form
      noValidate
      className="space-y-10"
      onSubmit={(event) => {
        event.preventDefault();
        setAttempted(true);
        if (hasDraftErrors(validateClientDraft(draft))) return;
        onSubmit(draft);
      }}
    >
      <section className="space-y-5" aria-labelledby={`${id}-basics`}>
        <div>
          <h3 id={`${id}-basics`} className="text-base font-semibold">
            Basics
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            What people see on the sign-in and consent screens.
          </p>
        </div>
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
        <div>
          <h3 id={`${id}-type`} className="text-base font-semibold">
            Application type
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Determines which redirect URIs are allowed and whether a secret is issued.
          </p>
        </div>
        <div role="radiogroup" aria-label="Platform" className="flex flex-col gap-3 sm:flex-row">
          <ChoiceCard
            checked={draft.applicationType === "web"}
            onSelect={() => setApplicationType("web")}
            icon={<Globe className="size-4" />}
            title="Web"
            description="Websites and web apps served over https."
          />
          <ChoiceCard
            checked={draft.applicationType === "native"}
            onSelect={() => setApplicationType("native")}
            icon={<Smartphone className="size-4" />}
            title="Native or local"
            description="Mobile, desktop, CLI tools, and local development on localhost."
          />
        </div>
        {mode === "create" ? (
          <div
            role="radiogroup"
            aria-label="Client type"
            className="flex flex-col gap-3 sm:flex-row"
          >
            <ChoiceCard
              checked={confidential}
              onSelect={() => onConfidentialChange?.(true)}
              icon={<Lock className="size-4" />}
              title="Confidential"
              description="Has a backend that can keep a client secret. Recommended for server-rendered apps and APIs."
            />
            <ChoiceCard
              checked={!confidential}
              onSelect={() => onConfidentialChange?.(false)}
              icon={<Unlock className="size-4" />}
              title="Public"
              description="Runs entirely on the device or in the browser. No secret; PKCE is required."
            />
          </div>
        ) : (
          <p className="text-xs leading-5 text-muted-foreground">
            The client type (confidential or public) is fixed after creation. Create a new
            application to change it.
          </p>
        )}
      </section>

      <section className="space-y-5" aria-labelledby={`${id}-redirects`}>
        <div>
          <h3 id={`${id}-redirects`} className="text-base font-semibold">
            Redirect URIs
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Where PoliNetwork sends people back after they sign in. Must match exactly.
          </p>
        </div>
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

      <section className="space-y-5" aria-labelledby={`${id}-scopes`}>
        <div>
          <h3 id={`${id}-scopes`} className="text-base font-semibold">
            Permissions
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            The most this app may request. People still review each request on the consent screen.
          </p>
        </div>
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
        {errors.scopes && (
          <p role="alert" className="text-xs leading-5 text-destructive">
            {errors.scopes}
          </p>
        )}
      </section>

      <details className="group rounded-xl border">
        <summary className="flex cursor-pointer list-none items-center gap-2 p-4 text-sm font-semibold marker:content-none">
          <ChevronRight
            className="size-4 transition-transform group-open:rotate-90"
            aria-hidden="true"
          />
          Advanced
          <span className="font-normal text-muted-foreground">
            Sign-out redirects, contacts, policies
          </span>
        </summary>
        <div className="space-y-8 border-t p-4 sm:p-5">
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
    </form>
  );
}
