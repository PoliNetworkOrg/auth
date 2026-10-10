// PROTOTYPE (proto/app-form): "Guided" — the same decisions, one step at a time.
import { useState, type ReactNode } from "react";
import { cn } from "cn";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Globe,
  KeyRound,
  Lock,
  LogIn,
  Server,
  Smartphone,
  Unlock,
} from "lucide-react";
import {
  activeApiScopes,
  credentialLabels,
  hasDraftErrors,
  oidcScopes,
  validateClientDraft,
  type OidcClientDraftErrors,
} from "@/auth/oidc-clients";
import { AppLogo } from "@/components/oidc/app-logo";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  ApiScopePicker,
  FieldError,
  JwksField,
  ScopeChecklist,
  TextField,
  UriRows,
  useClientDraft,
  type DraftApi,
  type VariantProps,
} from "./shared";

const steps = [
  { id: "basics", title: "Basics", hint: "Name and links" },
  { id: "connection", title: "Connection", hint: "How it gets tokens" },
  { id: "access", title: "Access", hint: "Redirects and permissions" },
  { id: "review", title: "Review", hint: "Check and save" },
] as const;
type StepId = (typeof steps)[number]["id"];

const fieldsByStep: Record<Exclude<StepId, "review">, (keyof OidcClientDraftErrors)[]> = {
  basics: ["name", "uri", "logo", "tosUri", "policyUri", "contactItems"],
  connection: ["credential", "jwks", "grants"],
  access: ["redirectUris", "redirectUriItems", "postLogoutRedirectUriItems", "scopes", "apiScopes"],
};

function stepHasErrors(step: StepId, errors: OidcClientDraftErrors) {
  return step !== "review" && fieldsByStep[step].some((field) => errors[field] !== undefined);
}

function Option({
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
        "flex w-full items-start gap-3 rounded-xl border p-4 text-left transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-60",
        checked ? "border-primary bg-primary/5" : "enabled:hover:bg-accent/60",
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg",
          checked ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
        )}
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

function Question({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="space-y-3">
      <legend className="mb-3 text-sm font-medium">{title}</legend>
      {children}
    </fieldset>
  );
}

function BasicsStep({ api, errors }: { api: DraftApi; errors: OidcClientDraftErrors }) {
  const { draft, update } = api;
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start gap-5">
        <AppLogo name={draft.name || "New app"} logo={draft.logo} className="size-16 text-lg" />
        <div className="min-w-0 flex-1 basis-64 space-y-5">
          <TextField
            label="Application name"
            placeholder="PoliNetwork Wiki"
            value={draft.name}
            error={errors.name}
            onChange={(v) => update("name", v)}
          />
          <TextField
            label="Homepage URL"
            hint="Optional. Shown on the consent screen."
            placeholder="https://app.polinetwork.org"
            value={draft.uri}
            error={errors.uri}
            onChange={(v) => update("uri", v)}
          />
          <TextField
            label="Logo URL"
            hint="Optional. A square https image."
            placeholder="https://app.polinetwork.org/icon.png"
            value={draft.logo}
            error={errors.logo}
            onChange={(v) => update("logo", v)}
          />
        </div>
      </div>
      <details className="group rounded-xl border">
        <summary className="cursor-pointer list-none p-4 text-sm font-medium marker:content-none">
          Contacts and policies <span className="font-normal text-muted-foreground">Optional</span>
        </summary>
        <div className="space-y-6 border-t p-4">
          <UriRows
            label="Contact emails"
            items={draft.contacts}
            itemErrors={errors.contactItems}
            placeholder="team@polinetwork.org"
            addLabel="Add contact"
            onChange={(v) => update("contacts", v)}
          />
          <div className="grid gap-5 sm:grid-cols-2">
            <TextField
              label="Privacy policy URL"
              value={draft.policyUri}
              error={errors.policyUri}
              onChange={(v) => update("policyUri", v)}
            />
            <TextField
              label="Terms of service URL"
              value={draft.tosUri}
              error={errors.tosUri}
              onChange={(v) => update("tosUri", v)}
            />
          </div>
        </div>
      </details>
    </div>
  );
}

function ConnectionStep({
  api,
  errors,
  canGrantApiAccess,
  apiAccess,
}: {
  api: DraftApi;
  errors: OidcClientDraftErrors;
  canGrantApiAccess: boolean;
  apiAccess: boolean;
}) {
  const { draft, update, setCredential } = api;
  return (
    <div className="space-y-8">
      <Question title="What will it do?">
        <div className="grid gap-3 sm:grid-cols-2">
          <Option
            role="checkbox"
            checked={draft.signIn}
            onSelect={() => update("signIn", !draft.signIn)}
            icon={<LogIn className="size-4" />}
            title="Sign people in"
            description="Shows “Sign in with PoliNetwork” and receives who the person is."
          />
          {apiAccess && (
            <Option
              role="checkbox"
              checked={draft.serviceAccess}
              disabled={!canGrantApiAccess || draft.credential === "public"}
              onSelect={() => update("serviceAccess", !draft.serviceAccess)}
              icon={<Server className="size-4" />}
              title="Call APIs as itself"
              description={
                canGrantApiAccess
                  ? "For bots and backends with no person signed in."
                  : "Only Master Admin can turn this on."
              }
            />
          )}
        </div>
        <FieldError>{errors.grants}</FieldError>
      </Question>
      {draft.signIn && (
        <Question title="Where does it run?">
          <div className="grid gap-3 sm:grid-cols-2">
            <Option
              checked={draft.applicationType === "web"}
              onSelect={() => update("applicationType", "web")}
              icon={<Globe className="size-4" />}
              title="On the web"
              description="A website or web app served over https."
            />
            <Option
              checked={draft.applicationType === "native"}
              onSelect={() => update("applicationType", "native")}
              icon={<Smartphone className="size-4" />}
              title="On a device or localhost"
              description="Mobile, desktop, CLI, or local development."
            />
          </div>
        </Question>
      )}
      <Question title="How does it prove who it is?">
        <div className="grid gap-3">
          <Option
            checked={draft.credential === "secret"}
            onSelect={() => setCredential("secret")}
            icon={<Lock className="size-4" />}
            title="With a client secret"
            description="Its server keeps a password we generate. Simplest for server-rendered apps."
          />
          <Option
            checked={draft.credential === "private-key"}
            onSelect={() => setCredential("private-key")}
            icon={<KeyRound className="size-4" />}
            title="With its own private key"
            description="It signs each request; you paste only its public JWKS. Best for services."
          />
          <Option
            checked={draft.credential === "public"}
            onSelect={() => setCredential("public")}
            icon={<Unlock className="size-4" />}
            title="It can't keep a secret"
            description="Runs in the browser or on a device. Uses PKCE instead."
          />
        </div>
      </Question>
      {draft.credential === "private-key" && (
        <JwksField value={draft.jwks} error={errors.jwks} onChange={(v) => update("jwks", v)} />
      )}
    </div>
  );
}

function AccessStep({
  api,
  errors,
  canGrantApiAccess,
  apiAccess,
}: {
  api: DraftApi;
  errors: OidcClientDraftErrors;
  canGrantApiAccess: boolean;
  apiAccess: boolean;
}) {
  const { draft, update } = api;
  return (
    <div className="space-y-8">
      {draft.signIn && (
        <>
          <UriRows
            label="Redirect URIs"
            items={draft.redirectUris}
            itemErrors={errors.redirectUriItems}
            error={errors.redirectUris}
            placeholder={
              draft.applicationType === "web"
                ? "https://app.polinetwork.org/auth/callback"
                : "http://localhost:3000/auth/callback"
            }
            addLabel="Add redirect URI"
            minItems={1}
            onChange={(v) => update("redirectUris", v)}
          />
          <div className="space-y-3">
            <p className="text-sm font-medium">What it may ask people for</p>
            <ScopeChecklist api={api} />
            <FieldError>{errors.scopes}</FieldError>
          </div>
          <details className="rounded-xl border">
            <summary className="cursor-pointer list-none p-4 text-sm font-medium marker:content-none">
              Sign-out <span className="font-normal text-muted-foreground">Optional</span>
            </summary>
            <div className="space-y-5 border-t p-4">
              <UriRows
                label="Post-logout redirect URIs"
                items={draft.postLogoutRedirectUris}
                itemErrors={errors.postLogoutRedirectUriItems}
                placeholder="https://app.polinetwork.org/signed-out"
                addLabel="Add post-logout URI"
                onChange={(v) => update("postLogoutRedirectUris", v)}
              />
              <label className="flex cursor-pointer items-start gap-3 text-sm">
                <Checkbox
                  checked={draft.enableEndSession}
                  className="mt-0.5"
                  onCheckedChange={(v) => update("enableEndSession", v === true)}
                />
                Let the app sign people out of PoliNetwork too
              </label>
            </div>
          </details>
        </>
      )}
      {apiAccess && (
        <div className="space-y-3">
          <p className="text-sm font-medium">
            PoliNetwork APIs{" "}
            <span className="font-normal text-muted-foreground">
              {canGrantApiAccess ? "Optional" : "Master Admin only"}
            </span>
          </p>
          <ApiScopePicker api={api} locked={!canGrantApiAccess} />
          <FieldError>{errors.apiScopes}</FieldError>
        </div>
      )}
    </div>
  );
}

function ReviewRow({
  label,
  children,
  onEdit,
}: {
  label: string;
  children: ReactNode;
  onEdit: () => void;
}) {
  return (
    <div className="flex items-start gap-4 py-3">
      <dt className="w-32 shrink-0 text-sm text-muted-foreground">{label}</dt>
      <dd className="min-w-0 flex-1 text-sm break-words">{children}</dd>
      <Button type="button" variant="ghost" size="sm" onClick={onEdit}>
        Edit
      </Button>
    </div>
  );
}

function ReviewStep({ api, go }: { api: DraftApi; go: (step: StepId) => void }) {
  const { draft } = api;
  const scopes = oidcScopes.filter((s) => draft.scopes.includes(s.id)).map((s) => s.label);
  const apis = activeApiScopes(draft);
  return (
    <dl className="divide-y">
      <ReviewRow label="Name" onEdit={() => go("basics")}>
        {draft.name || <span className="text-muted-foreground">Not set</span>}
      </ReviewRow>
      <ReviewRow label="Does" onEdit={() => go("connection")}>
        {[draft.signIn && "Signs people in", draft.serviceAccess && "Calls APIs as itself"]
          .filter(Boolean)
          .join(" · ") || <span className="text-muted-foreground">Nothing chosen</span>}
      </ReviewRow>
      <ReviewRow label="Credential" onEdit={() => go("connection")}>
        {credentialLabels[draft.credential]}
        {draft.signIn && ` · ${draft.applicationType === "web" ? "Web" : "Device or localhost"}`}
      </ReviewRow>
      {draft.signIn && (
        <ReviewRow label="Redirects" onEdit={() => go("access")}>
          <span className="font-mono text-xs">
            {draft.redirectUris.filter(Boolean).join("\n") || "None"}
          </span>
        </ReviewRow>
      )}
      {draft.signIn && (
        <ReviewRow label="Asks for" onEdit={() => go("access")}>
          {scopes.join(", ")}
        </ReviewRow>
      )}
      <ReviewRow label="APIs" onEdit={() => go("access")}>
        {apis.length ? apis.join(" ") : "None"}
      </ReviewRow>
    </dl>
  );
}

export function Guided(props: VariantProps) {
  const api = useClientDraft(props.initial);
  const create = props.mode === "create";
  const [step, setStep] = useState<StepId>(create ? "basics" : "review");
  const [attempted, setAttempted] = useState<Set<StepId>>(new Set());
  const allErrors = validateClientDraft(api.draft, { apiAccess: props.apiAccess });
  const shown: OidcClientDraftErrors = Object.fromEntries(
    Object.entries(allErrors).filter(([field]) =>
      [...attempted].some(
        (s) => s !== "review" && fieldsByStep[s].includes(field as keyof OidcClientDraftErrors),
      ),
    ),
  );
  const index = steps.findIndex((s) => s.id === step);
  const visit = (next: StepId) => {
    setAttempted((current) => new Set([...current, step]));
    setStep(next);
  };
  const submit = () => {
    setAttempted(new Set(["basics", "connection", "access"]));
    if (hasDraftErrors(allErrors)) {
      const broken = steps.find((s) => stepHasErrors(s.id, allErrors));
      if (broken) setStep(broken.id);
      return;
    }
    props.onSubmit(api.draft);
  };

  return (
    <Card>
      <CardContent className="space-y-8 pt-6">
        <nav aria-label="Steps">
          <ol className="grid grid-cols-4 gap-2">
            {steps.map((s, i) => {
              const done = create ? i < index : false;
              const broken = attempted.has(s.id) && stepHasErrors(s.id, allErrors);
              return (
                <li key={s.id}>
                  <button
                    type="button"
                    aria-current={s.id === step ? "step" : undefined}
                    onClick={() => (create && i > index ? undefined : visit(s.id))}
                    disabled={create && i > index}
                    className={cn(
                      "flex w-full flex-col gap-2 rounded-lg pt-1 text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-default",
                    )}
                  >
                    <span
                      className={cn(
                        "h-1 rounded-full",
                        s.id === step || done ? "bg-primary" : "bg-muted",
                        broken && "bg-destructive",
                      )}
                    />
                    <span className="flex items-center gap-1.5 text-sm font-medium">
                      {done && <Check className="size-3.5 text-primary" aria-hidden="true" />}
                      <span className={s.id === step ? "" : "text-muted-foreground"}>
                        {s.title}
                      </span>
                    </span>
                    <span className="hidden text-xs text-muted-foreground sm:block">{s.hint}</span>
                  </button>
                </li>
              );
            })}
          </ol>
        </nav>

        <div key={step}>
          {step === "basics" && <BasicsStep api={api} errors={shown} />}
          {step === "connection" && (
            <ConnectionStep
              api={api}
              errors={shown}
              apiAccess={props.apiAccess}
              canGrantApiAccess={props.canGrantApiAccess}
            />
          )}
          {step === "access" && (
            <AccessStep
              api={api}
              errors={shown}
              apiAccess={props.apiAccess}
              canGrantApiAccess={props.canGrantApiAccess}
            />
          )}
          {step === "review" && <ReviewStep api={api} go={setStep} />}
        </div>

        <div className="flex items-center justify-between gap-3 border-t pt-6">
          {index > 0 ? (
            <Button type="button" variant="ghost" onClick={() => setStep(steps[index - 1]!.id)}>
              <ArrowLeft aria-hidden="true" />
              Back
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            {!create && step !== "review" && (
              <Button type="button" variant="outline" onClick={submit}>
                Save changes
              </Button>
            )}
            {step === "review" ? (
              <Button type="button" onClick={submit}>
                {create ? "Create application" : "Save changes"}
              </Button>
            ) : (
              <Button type="button" onClick={() => visit(steps[index + 1]!.id)}>
                {steps[index + 1]!.title}
                <ArrowRight aria-hidden="true" />
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
