// PROTOTYPE (proto/app-form): "Intent" — start from what is being connected; settings read as sentences.
import { useState, type ReactNode } from "react";
import { cn } from "cn";
import { Bot, ChevronDown, Globe, Smartphone, SlidersHorizontal } from "lucide-react";
import {
  activeApiScopes,
  hasDraftErrors,
  oidcScopes,
  validateClientDraft,
  type OidcClientDraft,
  type OidcClientDraftErrors,
} from "@/auth/oidc-clients";
import { AppLogo } from "@/components/oidc/app-logo";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
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

type Kind = "website" | "client-app" | "service" | "custom";

const kinds: {
  id: Kind;
  icon: ReactNode;
  title: string;
  description: string;
  masterOnly?: boolean;
  defaults: Partial<OidcClientDraft>;
}[] = [
  {
    id: "website",
    icon: <Globe className="size-5" />,
    title: "A website with a server",
    description: "People sign in on a site whose server can keep a secret.",
    defaults: { signIn: true, serviceAccess: false, credential: "secret", applicationType: "web" },
  },
  {
    id: "client-app",
    icon: <Smartphone className="size-5" />,
    title: "A browser or mobile app",
    description: "Runs entirely on the person's device. No secret; uses PKCE.",
    defaults: { signIn: true, serviceAccess: false, credential: "public" },
  },
  {
    id: "service",
    icon: <Bot className="size-5" />,
    title: "A bot or backend service",
    description: "Calls PoliNetwork APIs on its own, signing with a private key.",
    masterOnly: true,
    defaults: {
      signIn: false,
      serviceAccess: true,
      credential: "private-key",
      redirectUris: [""],
    },
  },
  {
    id: "custom",
    icon: <SlidersHorizontal className="size-5" />,
    title: "Something else",
    description: "Pick every setting yourself.",
    defaults: {},
  },
];

function kindOf(draft: OidcClientDraft): Kind {
  if (draft.serviceAccess && !draft.signIn && draft.credential === "private-key") return "service";
  if (draft.signIn && !draft.serviceAccess && draft.credential === "public") return "client-app";
  if (draft.signIn && !draft.serviceAccess && draft.credential === "secret") return "website";
  return "custom";
}

function KindPicker({
  value,
  onChange,
  canGrantApiAccess,
}: {
  value: Kind | null;
  onChange: (kind: Kind) => void;
  canGrantApiAccess: boolean;
}) {
  return (
    <div role="radiogroup" aria-label="What are you connecting?" className="grid gap-3 sm:grid-cols-2">
      {kinds.map((kind) => {
        const disabled = kind.masterOnly && !canGrantApiAccess;
        const checked = value === kind.id;
        return (
          <button
            key={kind.id}
            type="button"
            role="radio"
            aria-checked={checked}
            disabled={disabled}
            onClick={() => onChange(kind.id)}
            className={cn(
              "flex items-start gap-4 rounded-2xl border p-5 text-left transition-[background-color,border-color] outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60",
              checked ? "border-primary bg-primary/5" : "enabled:hover:bg-accent/60",
            )}
          >
            <span
              aria-hidden="true"
              className={cn(
                "flex size-10 shrink-0 items-center justify-center rounded-xl",
                checked ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
              )}
            >
              {kind.icon}
            </span>
            <span className="min-w-0">
              <span className="block font-semibold">{kind.title}</span>
              <span className="mt-1 block text-sm leading-6 text-muted-foreground">
                {disabled ? "Only Master Admin can register services." : kind.description}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

function SentenceRow({
  label,
  sentence,
  open,
  onToggle,
  broken,
  children,
}: {
  label: string;
  sentence: ReactNode;
  open: boolean;
  onToggle: () => void;
  broken?: boolean;
  children: ReactNode;
}) {
  return (
    <li className="py-1">
      <div className="flex items-start gap-4 py-3">
        <span className="w-28 shrink-0 pt-0.5 text-xs font-medium tracking-wide text-muted-foreground uppercase">
          {label}
        </span>
        <p className={cn("min-w-0 flex-1 text-sm leading-6", broken && "text-destructive")}>
          {sentence}
        </p>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-expanded={open}
          onClick={onToggle}
          className="shrink-0"
        >
          {open ? "Done" : "Change"}
          <ChevronDown
            className={cn("transition-transform", open && "rotate-180")}
            aria-hidden="true"
          />
        </Button>
      </div>
      {open && <div className="mb-4 space-y-5 rounded-xl bg-muted/40 p-4 sm:ml-32">{children}</div>}
    </li>
  );
}

function list(items: string[]) {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

function keyCount(jwks: string) {
  try {
    const n = (JSON.parse(jwks) as { keys?: unknown[] }).keys?.length ?? 0;
    return n === 1 ? "1 public key" : `${n} public keys`;
  } catch {
    return "a JWKS that needs fixing";
  }
}

const scopePhrases: Record<string, string> = {
  openid: "who they are",
  profile: "their name and picture",
  email: "their email",
  "polinetwork:identity": "their PoliNetwork membership",
  offline_access: "to stay signed in",
};

function Summary({
  api,
  errors,
  open,
  setOpen,
  apiAccess,
  canGrantApiAccess,
}: {
  api: DraftApi;
  errors: OidcClientDraftErrors;
  open: Set<string>;
  setOpen: (id: string) => void;
  apiAccess: boolean;
  canGrantApiAccess: boolean;
}) {
  const { draft, update, setCredential } = api;
  const redirects = draft.redirectUris.filter((u) => u.trim());
  const apis = activeApiScopes(draft);
  const asked = oidcScopes.filter((s) => draft.scopes.includes(s.id)).map((s) => scopePhrases[s.id]!);
  const details = [
    draft.contacts.length && `${draft.contacts.length} contact${draft.contacts.length > 1 ? "s" : ""}`,
    draft.policyUri && "a privacy policy",
    draft.tosUri && "terms of service",
    draft.postLogoutRedirectUris.length && "sign-out redirects",
  ].filter(Boolean) as string[];

  return (
    <ul className="divide-y">
      <SentenceRow
        label="Signs in"
        open={open.has("signin")}
        onToggle={() => setOpen("signin")}
        broken={Boolean(errors.redirectUris || errors.redirectUriItems || errors.grants)}
        sentence={
          draft.signIn ? (
            <>
              Signs people in{" "}
              {draft.applicationType === "web" ? "on the web" : "on a device or localhost"} and
              sends them back to{" "}
              {redirects.length === 1 ? (
                <code className="font-mono text-xs break-all">{redirects[0]}</code>
              ) : (
                `${redirects.length} addresses`
              )}
              .
            </>
          ) : (
            "Doesn't sign people in."
          )
        }
      >
        <label className="flex cursor-pointer items-center gap-3 text-sm font-medium">
          <Checkbox checked={draft.signIn} onCheckedChange={(v) => update("signIn", v === true)} />
          Sign people in with PoliNetwork
        </label>
        {draft.signIn && (
          <>
            <div role="radiogroup" aria-label="Runs on" className="flex flex-wrap gap-2">
              {(["web", "native"] as const).map((type) => (
                <Button
                  key={type}
                  type="button"
                  role="radio"
                  aria-checked={draft.applicationType === type}
                  size="sm"
                  variant={draft.applicationType === type ? "default" : "outline"}
                  onClick={() => update("applicationType", type)}
                >
                  {type === "web" ? "On the web (https)" : "On a device or localhost"}
                </Button>
              ))}
            </div>
            <UriRows
              label="Send people back to"
              items={draft.redirectUris}
              itemErrors={errors.redirectUriItems}
              error={errors.redirectUris}
              placeholder="https://app.polinetwork.org/auth/callback"
              addLabel="Add address"
              minItems={1}
              onChange={(v) => update("redirectUris", v)}
            />
          </>
        )}
        <FieldError>{errors.grants}</FieldError>
      </SentenceRow>

      <SentenceRow
        label="Proves itself"
        open={open.has("credential")}
        onToggle={() => setOpen("credential")}
        broken={Boolean(errors.jwks)}
        sentence={
          draft.credential === "secret"
            ? "With a client secret, shown once when you save."
            : draft.credential === "private-key"
              ? draft.jwks.trim()
                ? `By signing with its own key (${keyCount(draft.jwks)} registered).`
                : "By signing with its own key. Paste its public JWKS."
              : "It can't keep a secret, so it uses PKCE."
        }
      >
        <div role="radiogroup" aria-label="Credential" className="space-y-2">
          {(
            [
              ["secret", "Client secret", "Its server keeps a secret we generate."],
              ["private-key", "Private key", "It signs requests; you paste only the public JWKS."],
              ["public", "Nothing (public)", "It runs on the device and uses PKCE."],
            ] as const
          ).map(([id, title, hint]) => (
            <label key={id} className="flex cursor-pointer items-start gap-3 text-sm">
              <input
                type="radio"
                name="credential"
                className="mt-1 accent-[var(--primary)]"
                checked={draft.credential === id}
                onChange={() => setCredential(id)}
              />
              <span>
                <span className="font-medium">{title}</span>
                <span className="block text-xs text-muted-foreground">{hint}</span>
              </span>
            </label>
          ))}
        </div>
        {draft.credential === "private-key" && (
          <JwksField value={draft.jwks} error={errors.jwks} onChange={(v) => update("jwks", v)} />
        )}
      </SentenceRow>

      {draft.signIn && (
        <SentenceRow
          label="Asks for"
          open={open.has("scopes")}
          onToggle={() => setOpen("scopes")}
          broken={Boolean(errors.scopes)}
          sentence={<>Asks people for {list(asked)}.</>}
        >
          <ScopeChecklist api={api} dense />
          <FieldError>{errors.scopes}</FieldError>
        </SentenceRow>
      )}

      {apiAccess && (
        <SentenceRow
          label="APIs"
          open={open.has("apis")}
          onToggle={() => setOpen("apis")}
          broken={Boolean(errors.apiScopes)}
          sentence={
            apis.length
              ? `Calls ${apis.length} PoliNetwork API ${apis.length === 1 ? "scope" : "scopes"}${draft.serviceAccess ? (draft.signIn ? ", for people and as itself" : " as itself") : " for the people it signs in"}.`
              : "Doesn't call PoliNetwork APIs."
          }
        >
          {!canGrantApiAccess && (
            <p className="text-sm text-muted-foreground">Only Master Admin can change API access.</p>
          )}
          <label className="flex cursor-pointer items-center gap-3 text-sm font-medium">
            <Checkbox
              checked={draft.serviceAccess}
              disabled={!canGrantApiAccess || draft.credential === "public"}
              onCheckedChange={(v) => update("serviceAccess", v === true)}
            />
            Also call APIs as itself, with no one signed in
          </label>
          <ApiScopePicker api={api} locked={!canGrantApiAccess} dense />
          <FieldError>{errors.apiScopes}</FieldError>
        </SentenceRow>
      )}

      <SentenceRow
        label="Details"
        open={open.has("details")}
        onToggle={() => setOpen("details")}
        broken={Boolean(errors.uri || errors.logo || errors.contactItems || errors.policyUri)}
        sentence={details.length ? `Has ${list(details)}.` : "No homepage, contacts, or policies."}
      >
        <div className="grid gap-5 sm:grid-cols-2">
          <TextField label="Homepage URL" value={draft.uri} error={errors.uri} onChange={(v) => update("uri", v)} />
          <TextField label="Logo URL" value={draft.logo} error={errors.logo} onChange={(v) => update("logo", v)} />
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
        <UriRows
          label="Contact emails"
          items={draft.contacts}
          itemErrors={errors.contactItems}
          placeholder="team@polinetwork.org"
          addLabel="Add contact"
          onChange={(v) => update("contacts", v)}
        />
        {draft.signIn && (
          <>
            <UriRows
              label="After signing out, send people to"
              items={draft.postLogoutRedirectUris}
              itemErrors={errors.postLogoutRedirectUriItems}
              placeholder="https://app.polinetwork.org/signed-out"
              addLabel="Add address"
              onChange={(v) => update("postLogoutRedirectUris", v)}
            />
            <label className="flex cursor-pointer items-center gap-3 text-sm">
              <Checkbox
                checked={draft.enableEndSession}
                onCheckedChange={(v) => update("enableEndSession", v === true)}
              />
              Signing out of the app also signs out of PoliNetwork
            </label>
          </>
        )}
      </SentenceRow>
    </ul>
  );
}

export function Intent(props: VariantProps) {
  const api = useClientDraft(props.initial);
  const create = props.mode === "create";
  const [kind, setKind] = useState<Kind | null>(create ? null : kindOf(props.initial));
  const [open, setOpenState] = useState<Set<string>>(new Set());
  const [attempted, setAttempted] = useState(false);
  const errors = attempted ? validateClientDraft(api.draft, { apiAccess: props.apiAccess }) : {};
  const toggle = (id: string) =>
    setOpenState((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  function chooseKind(next: Kind) {
    setKind(next);
    const defaults = kinds.find((k) => k.id === next)!.defaults;
    api.setDraft((current) => ({ ...current, ...defaults }));
    setOpenState(new Set(next === "custom" ? ["signin", "credential", "scopes", "apis"] : []));
  }

  function submit() {
    setAttempted(true);
    const found = validateClientDraft(api.draft, { apiAccess: props.apiAccess });
    if (hasDraftErrors(found)) {
      const rows = new Set(open);
      if (found.redirectUris || found.redirectUriItems || found.grants) rows.add("signin");
      if (found.jwks) rows.add("credential");
      if (found.scopes) rows.add("scopes");
      if (found.apiScopes) rows.add("apis");
      if (found.uri || found.logo || found.contactItems || found.policyUri || found.tosUri)
        rows.add("details");
      setOpenState(rows);
      return;
    }
    props.onSubmit(api.draft);
  }

  const { draft, update } = api;
  const needsRedirect = draft.signIn && kind !== "custom";
  const needsKey = draft.credential === "private-key" && kind === "service";

  return (
    <div className="space-y-6">
      {(create || kind === null) && (
        <section aria-label="What are you connecting?" className="space-y-4">
          <h2 className="text-lg font-semibold">What are you connecting?</h2>
          <KindPicker value={kind} onChange={chooseKind} canGrantApiAccess={props.canGrantApiAccess} />
        </section>
      )}
      {kind !== null && (
        <Card>
          <CardContent className="space-y-6 pt-6">
            <div className="flex items-start gap-4">
              <AppLogo name={draft.name || "New app"} logo={draft.logo} className="size-14 text-base" />
              <div className="min-w-0 flex-1">
                <TextField
                  label="Name"
                  placeholder={kind === "service" ? "Telegram Bot" : "PoliNetwork Wiki"}
                  value={draft.name}
                  error={errors.name}
                  onChange={(v) => update("name", v)}
                />
                {!create && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    {kinds.find((k) => k.id === kind)!.title}
                  </p>
                )}
              </div>
            </div>
            {create && needsRedirect && (
              <TextField
                label="Where should people land after signing in?"
                hint="The exact callback URL of your app. Add more later."
                placeholder={
                  draft.applicationType === "web"
                    ? "https://app.polinetwork.org/auth/callback"
                    : "http://localhost:3000/auth/callback"
                }
                mono
                value={draft.redirectUris[0] ?? ""}
                error={errors.redirectUriItems?.[0] ?? errors.redirectUris}
                onChange={(v) => update("redirectUris", [v, ...draft.redirectUris.slice(1)])}
              />
            )}
            {create && needsKey && (
              <JwksField value={draft.jwks} error={errors.jwks} onChange={(v) => update("jwks", v)} />
            )}
            <div>
              <Label className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                {create ? "What we'll set up" : "Settings"}
              </Label>
              <Summary
                api={api}
                errors={errors}
                open={open}
                setOpen={toggle}
                apiAccess={props.apiAccess}
                canGrantApiAccess={props.canGrantApiAccess}
              />
            </div>
            <div className="flex justify-end gap-3 border-t pt-6">
              <Button type="button" onClick={submit}>
                {create ? "Create application" : "Save changes"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
