import { useState, type ReactNode } from "react";
import { cn } from "cn";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  KeyRound,
  Link2,
  LoaderCircle,
  Lock,
  Network,
  Server,
  Sparkles,
  Unlock,
  UserRound,
} from "lucide-react";
import {
  apiScopes,
  hasDraftErrors,
  MAX_CLIENT_NAME_LENGTH,
  validateClientDraft,
  type OidcClientCredential,
  type OidcClientDraft,
  type OidcClientDraftErrors,
} from "@/auth/oidc-clients";
import { AppLogo } from "@/components/oidc/app-logo";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  ApiScopeList,
  credentialInfo,
  FieldError,
  IdentityScopeList,
  JwksField,
  ListField,
  RedirectRule,
  RequiredMark,
  SwitchRow,
  TextField,
} from "./form-fields";
import { useClientDraft, type ClientDraftApi } from "./use-client-draft";
import { firstIncompleteStep, stepErrors, wizardSteps, type WizardStepId } from "./wizard-steps";

type WizardProps = {
  initial: OidcClientDraft;
  apiAccess: boolean;
  canGrantApiAccess: boolean;
  busy: boolean;
  /** Errors the server returned for the last attempt, in the draft's shape. */
  serverErrors?: OidcClientDraftErrors;
  onSubmit: (draft: OidcClientDraft) => void;
  onCancel: () => void;
};

function StepHeading({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div>
      <h2 className="text-lg font-semibold">{title}</h2>
      {children && <p className="mt-1 text-sm text-muted-foreground">{children}</p>}
    </div>
  );
}

function BasicsStep({ api, errors }: { api: ClientDraftApi; errors: OidcClientDraftErrors }) {
  const { draft, update } = api;
  return (
    <div className="space-y-6">
      <StepHeading title="Basics">What people see when they sign in.</StepHeading>
      <TextField
        label="Application name"
        required
        inputMode="text"
        maxLength={MAX_CLIENT_NAME_LENGTH}
        placeholder="PoliNetwork Wiki"
        value={draft.name}
        error={errors.name}
        onChange={(value) => update("name", value)}
      />
      <TextField
        label="Homepage URL"
        placeholder="https://app.polinetwork.org"
        value={draft.uri}
        error={errors.uri}
        onChange={(value) => update("uri", value)}
      />
      <TextField
        label="Logo URL"
        hint="A square https image."
        placeholder="https://app.polinetwork.org/icon.png"
        value={draft.logo}
        error={errors.logo}
        onChange={(value) => update("logo", value)}
      />
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
  );
}

function UsageStep({
  api,
  errors,
  apiAccess,
  canGrantApiAccess,
}: {
  api: ClientDraftApi;
  errors: OidcClientDraftErrors;
  apiAccess: boolean;
  canGrantApiAccess: boolean;
}) {
  const { draft, update } = api;
  return (
    <div className="space-y-6">
      <StepHeading title="Usage">
        Turn on everything the app does. It decides which credentials it can use.
      </StepHeading>
      <fieldset className="space-y-3" aria-required>
        <legend className="flex items-center gap-1 text-sm font-medium">
          The app
          <RequiredMark />
        </legend>
        <div className="mt-3 divide-y rounded-lg border">
          <div className="p-4">
            <SwitchRow
              title="Signs people in"
              description="People sign in with PoliNetwork and the app learns who they are. It can then act on their behalf."
              checked={draft.signIn}
              onCheckedChange={(checked) => update("signIn", checked)}
            />
          </div>
          <div className="p-4">
            <SwitchRow
              title="Calls APIs as itself"
              description={
                !apiAccess
                  ? "PoliNetwork APIs are not configured on this server."
                  : canGrantApiAccess
                    ? "The app gets tokens with no one signed in, for bots and backends."
                    : "The app gets tokens with no one signed in. Only Master Admin can turn this on."
              }
              checked={draft.serviceAccess}
              disabled={!apiAccess || !canGrantApiAccess}
              onCheckedChange={(checked) => update("serviceAccess", checked)}
            />
          </div>
        </div>
        <FieldError>{errors.grants}</FieldError>
      </fieldset>
    </div>
  );
}

const credentialIcons: Record<OidcClientCredential, ReactNode> = {
  secret: <Lock className="size-4" />,
  "private-key": <KeyRound className="size-4" />,
  public: <Unlock className="size-4" />,
};

function AuthenticationStep({
  api,
  errors,
}: {
  api: ClientDraftApi;
  errors: OidcClientDraftErrors;
}) {
  const { draft, update, setCredential } = api;
  return (
    <div className="space-y-6">
      <StepHeading title="Authentication">How the app proves who it is to PoliNetwork.</StepHeading>
      <div role="radiogroup" aria-label="Credential" className="grid gap-3">
        {(["secret", "private-key", "public"] as const).map((credential) => {
          // A client that acts as itself has to authenticate, which a public client can't.
          const unavailable = credential === "public" && draft.serviceAccess;
          const checked = draft.credential === credential;
          return (
            <button
              key={credential}
              type="button"
              role="radio"
              aria-checked={checked}
              disabled={unavailable}
              onClick={() => setCredential(credential)}
              className={cn(
                "flex items-start gap-3 rounded-lg border p-4 text-left transition-[background-color,border-color] outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-60",
                checked ? "border-primary bg-primary/5" : "enabled:hover:bg-accent/50",
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  "flex size-8 shrink-0 items-center justify-center rounded-md",
                  checked ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
                )}
              >
                {credentialIcons[credential]}
              </span>
              <span className="min-w-0">
                <span className="flex items-center gap-2 text-sm font-medium">
                  {credentialInfo[credential].title}
                  {credential === "private-key" && draft.serviceAccess && (
                    <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[11px] font-normal text-primary">
                      Recommended
                    </span>
                  )}
                </span>
                <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                  {unavailable
                    ? "Not available for apps that call APIs as themselves."
                    : credentialInfo[credential].description}
                </span>
              </span>
            </button>
          );
        })}
      </div>
      <FieldError>{errors.grants}</FieldError>
      {draft.credential === "private-key" && (
        <JwksField
          value={draft.jwks}
          error={errors.jwks}
          onChange={(value) => update("jwks", value)}
        />
      )}
    </div>
  );
}

function AccessStep({
  api,
  errors,
  apiAccess,
  canGrantApiAccess,
}: {
  api: ClientDraftApi;
  errors: OidcClientDraftErrors;
  apiAccess: boolean;
  canGrantApiAccess: boolean;
}) {
  const { draft, update } = api;
  return (
    <div className="space-y-10">
      <StepHeading title="Access">What the app can reach, for each thing it does.</StepHeading>
      {draft.signIn && (
        <section aria-labelledby="access-people" className="space-y-6">
          <h3 id="access-people" className="text-base font-semibold">
            People who sign in
          </h3>
          <RedirectRule
            value={draft.applicationType}
            onChange={(value) => update("applicationType", value)}
          />
          <ListField
            label="Redirect URIs"
            required
            minItems={1}
            items={draft.redirectUris}
            itemErrors={errors.redirectUriItems}
            error={errors.redirectUris}
            hint="Where PoliNetwork sends people back after they sign in. Must match exactly."
            placeholder={
              draft.applicationType === "web"
                ? "https://app.polinetwork.org/auth/callback"
                : "http://localhost:3000/auth/callback"
            }
            addLabel="Add redirect URI"
            onChange={(items) => update("redirectUris", items)}
          />
          <IdentityScopeList api={api} legend="What it may ask people for" />
          <FieldError>{errors.scopes}</FieldError>
          {apiAccess && (
            <ApiScopeList
              api={api}
              list="apiScopes"
              legend="PoliNetwork APIs it may call for them"
              locked={!canGrantApiAccess}
              error={draft.serviceAccess ? undefined : errors.apiScopes}
            />
          )}
        </section>
      )}
      {draft.signIn && (
        <section aria-labelledby="access-logout" className="space-y-6">
          <h3 id="access-logout" className="text-base font-semibold">
            Logout
          </h3>
          <ListField
            label="Post-logout redirect URIs"
            items={draft.postLogoutRedirectUris}
            itemErrors={errors.postLogoutRedirectUriItems}
            hint="Where people may land after signing out from the app."
            placeholder="https://app.polinetwork.org/signed-out"
            addLabel="Add post-logout URI"
            onChange={(items) => update("postLogoutRedirectUris", items)}
          />
          <div className="flex items-start gap-3">
            <Checkbox
              id="wizard-end-session"
              checked={draft.enableEndSession}
              className="mt-0.5"
              onCheckedChange={(value) => update("enableEndSession", value === true)}
            />
            <Label htmlFor="wizard-end-session" className="cursor-pointer leading-5">
              Signing out of the app also ends the PoliNetwork session
            </Label>
          </div>
        </section>
      )}
      {draft.serviceAccess && (
        <section aria-labelledby="access-itself" className="space-y-6">
          <h3 id="access-itself" className="text-base font-semibold">
            The application itself
          </h3>
          <ApiScopeList
            api={api}
            list="serviceScopes"
            legend="PoliNetwork APIs it may call as itself"
            required
            locked={!canGrantApiAccess}
            error={errors.apiScopes}
          />
        </section>
      )}
    </div>
  );
}

/**
 * One line of the summary: an icon that lights up once the step that sets it is reached,
 * and a short value, which fades in as it changes.
 */
function SummaryItem({
  icon,
  label,
  pending,
  children,
}: {
  icon: ReactNode;
  label: string;
  pending: boolean;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center gap-3">
      <span
        aria-hidden="true"
        className={cn(
          "flex size-8 shrink-0 items-center justify-center rounded-lg transition-colors duration-200 [&_svg]:size-4",
          pending ? "border border-dashed text-muted-foreground/60" : "bg-primary/10 text-primary",
        )}
      >
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p
          key={pending ? "pending" : "set"}
          className={cn(
            "truncate text-sm",
            pending
              ? "text-muted-foreground/60"
              : "duration-200 animate-in fade-in motion-reduce:animate-none",
          )}
        >
          {pending ? "Not set yet" : children}
        </p>
      </div>
    </div>
  );
}

function plural(count: number, one: string, many = `${one}s`) {
  return `${count} ${count === 1 ? one : many}`;
}

function keyCount(jwks: string) {
  try {
    return plural((JSON.parse(jwks) as { keys?: unknown[] }).keys?.length ?? 0, "key");
  } catch {
    return "JWKS to fix";
  }
}

const summaryCredentialIcons: Record<OidcClientCredential, ReactNode> = {
  secret: <Lock />,
  "private-key": <KeyRound />,
  public: <Unlock />,
};

// Short names for what a signed-in person shares; "openid" is always there, so it's implied.
const sharedData: Record<string, string> = {
  profile: "profile",
  email: "email",
  "polinetwork:identity": "membership",
  offline_access: "stays signed in",
};

/** Counts API scopes per resource, e.g. "2 backend, 1 internal". */
function apiSummary(ids: string[]) {
  if (!ids.length) return "None";
  const backend = apiScopes.filter((s) => s.resource === "backend" && ids.includes(s.id)).length;
  const internal = apiScopes.filter((s) => s.resource === "internal" && ids.includes(s.id)).length;
  return [backend && `${backend} backend`, internal && `${internal} internal`]
    .filter(Boolean)
    .join(", ")
    .concat(ids.length === 1 ? " scope" : " scopes");
}

/** A short recap of what the wizard will register, filled in as each step is reached. */
function Summary({ draft, reached }: { draft: OidcClientDraft; reached: number }) {
  const redirects = draft.redirectUris.filter((uri) => uri.trim()).length;
  const shared = draft.scopes.filter((scope) => scope in sharedData).map((s) => sharedData[s]);
  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <AppLogo name={draft.name || "New app"} logo={draft.logo} className="size-11" />
        <p className="line-clamp-2 min-w-0 font-semibold break-words">
          {draft.name.trim() || "Untitled application"}
        </p>
      </div>
      <div className="space-y-4">
        <SummaryItem icon={<Sparkles />} label="Does" pending={reached < 1}>
          {[draft.signIn && "Signs people in", draft.serviceAccess && "Calls APIs"]
            .filter(Boolean)
            .join(" · ") || "Nothing yet"}
        </SummaryItem>
        <SummaryItem
          icon={summaryCredentialIcons[draft.credential]}
          label="Credential"
          pending={reached < 2}
        >
          {credentialInfo[draft.credential].title}
          {draft.credential === "private-key" && draft.jwks.trim() && ` · ${keyCount(draft.jwks)}`}
        </SummaryItem>
        {draft.signIn && (
          <>
            <SummaryItem icon={<Link2 />} label="Redirects" pending={reached < 3}>
              {plural(redirects, "URI")} ·{" "}
              {draft.applicationType === "web" ? "https only" : "localhost allowed"}
            </SummaryItem>
            <SummaryItem icon={<UserRound />} label="Asks people for" pending={reached < 3}>
              {shared.length ? `Identity, ${shared.join(", ")}` : "Identity only"}
            </SummaryItem>
            {draft.apiScopes.length > 0 && (
              <SummaryItem icon={<Network />} label="APIs for people" pending={reached < 3}>
                {apiSummary(draft.apiScopes)}
              </SummaryItem>
            )}
          </>
        )}
        {draft.serviceAccess && (
          <SummaryItem icon={<Server />} label="APIs as itself" pending={reached < 3}>
            {apiSummary(draft.serviceScopes)}
          </SummaryItem>
        )}
      </div>
    </div>
  );
}

export function NewApplicationWizard({
  initial,
  apiAccess,
  canGrantApiAccess,
  busy,
  serverErrors,
  onSubmit,
  onCancel,
}: WizardProps) {
  const api = useClientDraft(initial);
  const { draft } = api;
  const [step, setStep] = useState(0);
  // The furthest step opened so far; the summary fills in up to it.
  const [reached, setReached] = useState(0);
  const [attempted, setAttempted] = useState<Set<WizardStepId>>(new Set());
  const [reviewing, setReviewing] = useState(false);

  const errors = validateClientDraft(draft, { apiAccess });
  const allErrors: OidcClientDraftErrors = { ...serverErrors, ...errors };
  const current = wizardSteps[step]!;
  const shown = (id: WizardStepId) =>
    attempted.has(id) || serverErrors ? stepErrors(id, allErrors, draft) : {};
  // A step opens once every step before it is complete.
  const unlocked = firstIncompleteStep(errors, draft);

  function goTo(index: number) {
    setStep(index);
    setReached((value) => Math.max(value, index));
    setReviewing(false);
  }
  function next() {
    setAttempted((value) => new Set([...value, current.id]));
    if (Object.keys(stepErrors(current.id, errors, draft)).length > 0) return;
    if (step < wizardSteps.length - 1) goTo(step + 1);
    else if (!hasDraftErrors(errors)) setReviewing(true);
  }
  // Server-side refusals send the person back to the step that can fix them.
  const [loadedServerErrors, setLoadedServerErrors] = useState(serverErrors);
  if (serverErrors !== loadedServerErrors) {
    setLoadedServerErrors(serverErrors);
    if (serverErrors && hasDraftErrors(serverErrors)) {
      const index = firstIncompleteStep(serverErrors, draft);
      if (index < wizardSteps.length) {
        setStep(index);
        setReviewing(false);
      }
    }
  }

  const stepper = (
    <nav aria-label="Steps">
      <ol className="grid grid-cols-4 gap-2">
        {wizardSteps.map((s, index) => {
          const done = index < unlocked && index < reached + 1 && index !== step;
          const locked = index > unlocked || index > reached + 1;
          const broken = attempted.has(s.id) && Object.keys(shown(s.id)).length > 0;
          return (
            <li key={s.id}>
              <button
                type="button"
                aria-current={!reviewing && index === step ? "step" : undefined}
                disabled={locked}
                onClick={() => goTo(index)}
                className="flex w-full flex-col gap-2 rounded-md pt-1 pb-1 text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed"
              >
                <span
                  className={cn(
                    "h-1 rounded-full transition-colors duration-200",
                    broken
                      ? "bg-destructive"
                      : index === step || index < reached || reviewing
                        ? "bg-primary"
                        : "bg-muted",
                  )}
                />
                <span
                  className={cn(
                    "flex items-center gap-1.5 text-sm font-medium",
                    !reviewing && index === step ? "text-foreground" : "text-muted-foreground",
                    locked && "opacity-60",
                  )}
                >
                  {(done || reviewing) && !broken && (
                    <Check className="size-3.5 text-primary" aria-hidden="true" />
                  )}
                  {s.title}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );

  if (reviewing)
    return (
      <div className="space-y-8">
        {stepper}
        <Card className="mx-auto max-w-2xl animate-in duration-300 ease-[cubic-bezier(0.23,1,0.32,1)] fade-in slide-in-from-right-8 motion-reduce:slide-in-from-right-0">
          <CardContent className="space-y-6 pt-6">
            <div>
              <h2 className="text-lg font-semibold">Review</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Check the settings before creating the application. You can change them later.
              </p>
            </div>
            <Summary draft={draft} reached={wizardSteps.length} />
            <div className="flex flex-col-reverse gap-3 border-t pt-6 sm:flex-row sm:justify-between">
              <Button
                type="button"
                variant="ghost"
                disabled={busy}
                onClick={() => setReviewing(false)}
              >
                <ArrowLeft aria-hidden="true" />
                Go back
              </Button>
              <Button type="button" disabled={busy} onClick={() => onSubmit(draft)}>
                {busy && <LoaderCircle className="animate-spin" aria-hidden="true" />}
                Create application
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );

  return (
    <div className="space-y-8">
      {stepper}
      <div className="grid items-start gap-8 lg:grid-cols-[1fr_300px]">
        <Card>
          <CardContent className="pt-6">
            <form
              noValidate
              className="space-y-8"
              onSubmit={(event) => {
                event.preventDefault();
                next();
              }}
            >
              {current.id === "basics" && <BasicsStep api={api} errors={shown("basics")} />}
              {current.id === "usage" && (
                <UsageStep
                  api={api}
                  errors={shown("usage")}
                  apiAccess={apiAccess}
                  canGrantApiAccess={canGrantApiAccess}
                />
              )}
              {current.id === "authentication" && (
                <AuthenticationStep api={api} errors={shown("authentication")} />
              )}
              {current.id === "access" && (
                <AccessStep
                  api={api}
                  errors={shown("access")}
                  apiAccess={apiAccess}
                  canGrantApiAccess={canGrantApiAccess}
                />
              )}
              <div className="flex items-center justify-between gap-3 border-t pt-6">
                {step > 0 ? (
                  <Button type="button" variant="ghost" onClick={() => goTo(step - 1)}>
                    <ArrowLeft aria-hidden="true" />
                    Back
                  </Button>
                ) : (
                  <Button type="button" variant="ghost" onClick={onCancel}>
                    Cancel
                  </Button>
                )}
                <Button type="submit">
                  {step < wizardSteps.length - 1 ? wizardSteps[step + 1]!.title : "Review"}
                  <ArrowRight aria-hidden="true" />
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
        <aside aria-label="Summary" className="lg:sticky lg:top-24">
          <Card>
            <CardContent className="pt-6">
              <Summary draft={draft} reached={reached} />
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  );
}
