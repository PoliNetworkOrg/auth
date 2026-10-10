// PROTOTYPE (proto/app-form): "Settings" — a settings page: section nav, label-left rows, sticky save.
import { useEffect, useState, type ReactNode } from "react";
import { cn } from "cn";
import { LoaderCircle } from "lucide-react";
import {
  hasDraftErrors,
  validateClientDraft,
  type OidcClientCredential,
  type OidcClientDraftErrors,
} from "@/auth/oidc-clients";
import { AppLogo } from "@/components/oidc/app-logo";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  ApiScopePicker,
  FieldError,
  JwksField,
  ScopeChecklist,
  TextField,
  UriRows,
  useClientDraft,
  type VariantProps,
} from "./shared";

function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { id: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex flex-wrap gap-1 rounded-lg bg-muted p-1">
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          role="radio"
          aria-checked={value === option.id}
          onClick={() => onChange(option.id)}
          className={cn(
            "h-8 rounded-md px-3 text-sm transition-[color,background-color,box-shadow] outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 active:scale-[0.96]",
            value === option.id
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/** One setting: what it is on the left, the control on the right. */
function Row({
  title,
  help,
  children,
  htmlFor,
}: {
  title: string;
  help?: ReactNode;
  children: ReactNode;
  htmlFor?: string;
}) {
  return (
    <div className="grid gap-x-8 gap-y-3 px-5 py-5 sm:grid-cols-[200px_1fr] sm:px-6">
      <div>
        {htmlFor ? (
          <Label htmlFor={htmlFor} className="cursor-pointer">
            {title}
          </Label>
        ) : (
          <p className="text-sm font-medium">{title}</p>
        )}
        {help && <p className="mt-1 text-xs leading-5 text-muted-foreground">{help}</p>}
      </div>
      <div className="min-w-0 space-y-3">{children}</div>
    </div>
  );
}

function Group({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-24 space-y-3">
      <h3 id={`${id}-title`} className="text-sm font-semibold">
        {title}
      </h3>
      <Card className="gap-0 divide-y py-0">{children}</Card>
    </section>
  );
}

const credentialHelp: Record<OidcClientCredential, string> = {
  secret: "Its server keeps a secret we generate, shown once.",
  "private-key": "It signs each request with its own key. Paste only the public JWKS.",
  public: "Runs in the browser or on a device. No secret; PKCE is required.",
};

export function Settings(props: VariantProps) {
  const api = useClientDraft(props.initial);
  const { draft, update, setCredential } = api;
  const create = props.mode === "create";
  const [attempted, setAttempted] = useState(false);
  const [saving, setSaving] = useState(false);
  const errors: OidcClientDraftErrors = attempted
    ? validateClientDraft(draft, { apiAccess: props.apiAccess })
    : {};
  const dirty = JSON.stringify(draft) !== JSON.stringify(props.initial);
  const sections = [
    { id: "general", title: "General" },
    { id: "connection", title: "Connection" },
    ...(draft.signIn ? [{ id: "signin", title: "Sign-in" }] : []),
    ...(props.apiAccess ? [{ id: "apis", title: "API access" }] : []),
    { id: "details", title: "Details" },
  ];
  const [active, setActive] = useState("general");
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting);
        if (visible[0]) setActive(visible[0].target.id);
      },
      { rootMargin: "-20% 0px -70% 0px" },
    );
    for (const section of sections) {
      const el = document.getElementById(section.id);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [sections.length]);

  function submit() {
    setAttempted(true);
    if (hasDraftErrors(validateClientDraft(draft, { apiAccess: props.apiAccess }))) {
      requestAnimationFrame(() =>
        document.querySelector("[aria-invalid=true], [role=alert]")?.scrollIntoView({
          block: "center",
        }),
      );
      return;
    }
    setSaving(true);
    setTimeout(() => {
      setSaving(false);
      props.onSubmit(draft);
    }, 500);
  }

  return (
    <div className="grid items-start gap-8 lg:grid-cols-[160px_1fr]">
      <nav aria-label="Settings sections" className="sticky top-24 hidden lg:block">
        <ul className="space-y-1">
          {sections.map((section) => (
            <li key={section.id}>
              <a
                href={`#${section.id}`}
                aria-current={active === section.id ? "true" : undefined}
                onClick={() => setActive(section.id)}
                className={cn(
                  "block rounded-md px-3 py-2 text-sm transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
                  active === section.id
                    ? "bg-accent text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {section.title}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <div className="min-w-0 space-y-10">
        <Group id="general" title="General">
          <Row title="Name and logo" help="Shown on the sign-in and consent screens.">
            <div className="flex items-start gap-4">
              <AppLogo name={draft.name || "New app"} logo={draft.logo} />
              <div className="min-w-0 flex-1 space-y-4">
                <TextField
                  label="Application name"
                  placeholder="PoliNetwork Wiki"
                  value={draft.name}
                  error={errors.name}
                  onChange={(v) => update("name", v)}
                />
                <TextField
                  label="Logo URL"
                  placeholder="https://app.polinetwork.org/icon.png"
                  value={draft.logo}
                  error={errors.logo}
                  onChange={(v) => update("logo", v)}
                />
              </div>
            </div>
          </Row>
          <Row title="Homepage" help="Optional. Lets people recognize the app.">
            <TextField
              label="Homepage URL"
              placeholder="https://app.polinetwork.org"
              value={draft.uri}
              error={errors.uri}
              onChange={(v) => update("uri", v)}
            />
          </Row>
        </Group>

        <Group id="connection" title="Connection">
          <Row title="Sign people in" help="Authorization code with PKCE." htmlFor="set-signin">
            <Switch
              id="set-signin"
              checked={draft.signIn}
              onCheckedChange={(v) => update("signIn", v)}
            />
          </Row>
          {props.apiAccess && (
            <Row
              title="Call APIs as itself"
              help={
                props.canGrantApiAccess
                  ? "Client credentials, for bots and backends."
                  : "Only Master Admin can change this."
              }
              htmlFor="set-service"
            >
              <Switch
                id="set-service"
                checked={draft.serviceAccess}
                disabled={!props.canGrantApiAccess || draft.credential === "public"}
                onCheckedChange={(v) => update("serviceAccess", v)}
              />
            </Row>
          )}
          {errors.grants && (
            <div className="px-6 py-3">
              <FieldError>{errors.grants}</FieldError>
            </div>
          )}
          <Row title="Credential" help={credentialHelp[draft.credential]}>
            <Segmented
              label="Credential"
              value={draft.credential}
              onChange={setCredential}
              options={[
                { id: "secret", label: "Client secret" },
                { id: "private-key", label: "Private key" },
                { id: "public", label: "Public" },
              ]}
            />
            {!create && props.savedCredential !== draft.credential && (
              <p role="status" className="text-xs leading-5 text-muted-foreground">
                {draft.credential === "secret"
                  ? "A new secret is issued when you save."
                  : "The current credential stops working when you save."}
              </p>
            )}
            {draft.credential === "private-key" && (
              <JwksField value={draft.jwks} error={errors.jwks} onChange={(v) => update("jwks", v)} />
            )}
          </Row>
        </Group>

        {draft.signIn && (
          <Group id="signin" title="Sign-in">
            <Row
              title="Platform"
              help={
                draft.applicationType === "web"
                  ? "Redirects must be https on a public host."
                  : "Redirects may use localhost or a reverse-domain scheme."
              }
            >
              <Segmented
                label="Platform"
                value={draft.applicationType}
                onChange={(v) => update("applicationType", v)}
                options={[
                  { id: "web", label: "Web" },
                  { id: "native", label: "Native or local" },
                ]}
              />
            </Row>
            <Row title="Redirect URIs" help="Where people return after signing in. Exact match.">
              <UriRows
                label="Redirect URIs"
                hideLabel
                items={draft.redirectUris}
                itemErrors={errors.redirectUriItems}
                error={errors.redirectUris}
                placeholder="https://app.polinetwork.org/auth/callback"
                addLabel="Add redirect URI"
                minItems={1}
                onChange={(v) => update("redirectUris", v)}
              />
            </Row>
            <Row title="Permissions" help="The most it may ask people for.">
              <ScopeChecklist api={api} dense />
              <FieldError>{errors.scopes}</FieldError>
            </Row>
            <Row title="Sign-out" help="Optional.">
              <UriRows
                label="Post-logout redirect URIs"
                hideLabel
                items={draft.postLogoutRedirectUris}
                itemErrors={errors.postLogoutRedirectUriItems}
                placeholder="https://app.polinetwork.org/signed-out"
                addLabel="Add post-logout URI"
                onChange={(v) => update("postLogoutRedirectUris", v)}
              />
              <label className="flex cursor-pointer items-center gap-3 text-sm">
                <Checkbox
                  checked={draft.enableEndSession}
                  onCheckedChange={(v) => update("enableEndSession", v === true)}
                />
                Also end the PoliNetwork session
              </label>
            </Row>
          </Group>
        )}

        {props.apiAccess && (
          <Group id="apis" title="API access">
            <Row
              title="Scopes and resources"
              help={
                props.canGrantApiAccess
                  ? "PoliNetwork APIs it may call."
                  : "Only Master Admin can change these."
              }
            >
              <ApiScopePicker api={api} locked={!props.canGrantApiAccess} dense />
              <FieldError>{errors.apiScopes}</FieldError>
            </Row>
          </Group>
        )}

        <Group id="details" title="Details">
          <Row title="Contacts" help="Who to reach about this application.">
            <UriRows
              label="Contact emails"
              hideLabel
              items={draft.contacts}
              itemErrors={errors.contactItems}
              placeholder="team@polinetwork.org"
              addLabel="Add contact"
              onChange={(v) => update("contacts", v)}
            />
          </Row>
          <Row title="Policies" help="Linked from the consent screen.">
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField
                label="Privacy policy"
                value={draft.policyUri}
                error={errors.policyUri}
                onChange={(v) => update("policyUri", v)}
              />
              <TextField
                label="Terms of service"
                value={draft.tosUri}
                error={errors.tosUri}
                onChange={(v) => update("tosUri", v)}
              />
            </div>
          </Row>
        </Group>

        {(create || dirty) && (
          <div className="sticky bottom-4 z-10 flex items-center justify-between gap-4 rounded-xl border bg-card/95 px-5 py-3 shadow-lg backdrop-blur">
            <p className="text-sm text-muted-foreground">
              {create ? "Credentials appear once you create it." : "You have unsaved changes."}
            </p>
            <div className="flex gap-2">
              {!create && (
                <Button
                  type="button"
                  variant="ghost"
                  disabled={saving}
                  onClick={() => {
                    api.setDraft(props.initial);
                    setAttempted(false);
                  }}
                >
                  Discard
                </Button>
              )}
              <Button type="button" disabled={saving} onClick={submit}>
                {saving && <LoaderCircle className="animate-spin" aria-hidden="true" />}
                {create ? "Create application" : "Save changes"}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
