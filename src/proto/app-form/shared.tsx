// PROTOTYPE (proto/app-form): throwaway, imported only by src/routes/applications/proto.tsx.
import { useId, useState, type ReactNode } from "react";
import { cn } from "cn";
import { Plus, Trash2 } from "lucide-react";
import {
  activeApiScopes,
  apiScopes,
  clientRegistration,
  draftFromClient,
  emptyClientDraft,
  normalizeClientDraft,
  oidcResources,
  oidcScopes,
  type OidcClientCredential,
  type OidcClientDraft,
  type OidcClientSummary,
  type OidcResourceKey,
} from "@/auth/oidc-clients";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export type VariantProps = {
  mode: "create" | "edit";
  initial: OidcClientDraft;
  savedCredential?: OidcClientCredential;
  apiAccess: boolean;
  canGrantApiAccess: boolean;
  onSubmit: (draft: OidcClientDraft) => void;
};

const JWKS = JSON.stringify(
  {
    keys: [
      {
        kty: "OKP",
        crv: "Ed25519",
        x: "XSiHNTSI3BV5bsINJW8XObAVmUtZlySTlIH1U190R1Y",
        kid: "telegram-bot-2026-10",
      },
      {
        kty: "OKP",
        crv: "Ed25519",
        x: "u_EAwXXCGLbtuw5zKQt5869zALGBeCc5QbgIbDHrK2Y",
        kid: "telegram-bot-2027-01-rotation",
      },
    ],
  },
  null,
  2,
);

const base: OidcClientSummary = {
  clientId: "",
  name: "",
  uri: null,
  logo: null,
  redirectUris: [],
  postLogoutRedirectUris: [],
  contacts: [],
  tosUri: null,
  policyUri: null,
  scopes: [],
  credential: "secret",
  restricted: false,
  authMethod: "client_secret_basic",
  grantTypes: [],
  clientCredentialsScopes: [],
  resourceIds: [],
  resources: [],
  enableEndSession: false,
  jwks: null,
  applicationType: "web",
  disabled: false,
  skipConsent: false,
  createdAt: null,
  updatedAt: null,
  authorizedUsers: 0,
};

export const scenarios = {
  new: { label: "New application", mode: "create" as const, draft: emptyClientDraft() },
  wiki: {
    label: "Edit: sign-in app",
    mode: "edit" as const,
    draft: draftFromClient({
      ...base,
      clientId: "HtmaLGQrBbuHitWQbVQntxoUCIngsfGt",
      name: "Biblioteca Appunti — Ingegneria Informatica, Politecnico di Milano (Leonardo)",
      uri: "https://appunti.polinetwork.org",
      logo: "https://appunti.polinetwork.org/static/brand/icon-square-512.png",
      redirectUris: [
        "https://appunti.polinetwork.org/api/auth/callback/polinetwork",
        "https://staging.appunti.polinetwork.org/api/auth/callback/polinetwork",
        "https://preview-pr-1284.appunti-polinetwork.pages.dev/api/auth/callback/polinetwork",
      ],
      postLogoutRedirectUris: ["https://appunti.polinetwork.org/signed-out"],
      contacts: ["appunti@polinetwork.org", "it-team@polinetwork.org"],
      policyUri: "https://appunti.polinetwork.org/privacy",
      scopes: ["openid", "profile", "email", "polinetwork:identity", "offline_access"],
      grantTypes: ["authorization_code", "refresh_token"],
      enableEndSession: true,
    }),
    saved: "secret" as const,
  },
  bot: {
    label: "Edit: service",
    mode: "edit" as const,
    draft: draftFromClient({
      ...base,
      clientId: "LqYDencslpsWTylMpuASvQNfSgMejQmv",
      name: "Telegram Bot",
      scopes: apiScopes.filter((s) => s.id.startsWith("backend:tg:")).map((s) => s.id),
      credential: "private-key",
      authMethod: "private_key_jwt",
      restricted: true,
      grantTypes: ["client_credentials"],
      clientCredentialsScopes: apiScopes
        .filter((s) => s.id.startsWith("backend:tg:"))
        .map((s) => s.id),
      resources: ["backend"],
      jwks: JWKS,
    }),
    saved: "private-key" as const,
  },
};
export type ScenarioKey = keyof typeof scenarios;

/** The draft plus every mutation the form needs, shared by all variants. */
export function useClientDraft(initial: OidcClientDraft) {
  const [draft, setDraft] = useState(initial);
  function update<K extends keyof OidcClientDraft>(key: K, value: OidcClientDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }
  function setCredential(credential: OidcClientCredential) {
    setDraft((current) => ({
      ...current,
      credential,
      ...(credential === "public" ? { serviceAccess: false, signIn: true } : {}),
    }));
  }
  function toggleIn(key: "scopes" | "apiScopes" | "serviceScopes", id: string, on: boolean) {
    setDraft((current) => {
      const next = on ? [...current[key], id] : current[key].filter((s) => s !== id);
      const resource = apiScopes.find((s) => s.id === id)?.resource;
      return {
        ...current,
        [key]: next,
        resources:
          on && resource && !current.resources.includes(resource)
            ? [...current.resources, resource]
            : current.resources,
      };
    });
  }
  function toggleResource(id: OidcResourceKey, on: boolean) {
    const belongs = (s: string) => apiScopes.find((k) => k.id === s)?.resource === id;
    setDraft((current) => ({
      ...current,
      resources: on ? [...current.resources, id] : current.resources.filter((r) => r !== id),
      ...(on
        ? {}
        : {
            apiScopes: current.apiScopes.filter((s) => !belongs(s)),
            serviceScopes: current.serviceScopes.filter((s) => !belongs(s)),
          }),
    }));
  }
  return { draft, setDraft, update, setCredential, toggleIn, toggleResource };
}
export type DraftApi = ReturnType<typeof useClientDraft>;

export function FieldError({ children, id }: { children?: string; id?: string }) {
  if (!children) return null;
  return (
    <p id={id} role="alert" className="text-xs leading-5 text-destructive">
      {children}
    </p>
  );
}

export function TextField({
  label,
  hint,
  error,
  value,
  onChange,
  placeholder,
  mono,
  className,
}: {
  label: string;
  hint?: string;
  error?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  mono?: boolean;
  className?: string;
}) {
  const id = useId();
  return (
    <div className={cn("space-y-2", className)}>
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        value={value}
        autoComplete="off"
        spellCheck={false}
        placeholder={placeholder}
        aria-invalid={!!error}
        aria-describedby={error ? `${id}-e` : hint ? `${id}-h` : undefined}
        className={mono ? "font-mono text-sm" : undefined}
        onChange={(event) => onChange(event.target.value)}
      />
      {error ? (
        <FieldError id={`${id}-e`}>{error}</FieldError>
      ) : hint ? (
        <p id={`${id}-h`} className="text-xs leading-5 text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function UriRows({
  label,
  items,
  itemErrors,
  error,
  placeholder,
  addLabel,
  minItems = 0,
  onChange,
  hideLabel,
}: {
  label: string;
  items: string[];
  itemErrors?: (string | null)[];
  error?: string;
  placeholder: string;
  addLabel: string;
  minItems?: number;
  onChange: (items: string[]) => void;
  hideLabel?: boolean;
}) {
  const id = useId();
  return (
    <fieldset className="space-y-2">
      <legend className={cn("text-sm font-medium", hideLabel && "sr-only")}>{label}</legend>
      {items.map((item, index) => {
        const itemError = itemErrors?.[index] ?? undefined;
        return (
          <div key={`${id}-${index}`} className="space-y-1">
            <div className="flex items-center gap-2">
              <Input
                value={item}
                inputMode="url"
                autoComplete="off"
                spellCheck={false}
                aria-label={`${label} ${index + 1}`}
                aria-invalid={!!itemError}
                placeholder={placeholder}
                className="font-mono text-sm"
                onChange={(event) =>
                  onChange(items.map((v, i) => (i === index ? event.target.value : v)))
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
            <FieldError>{itemError}</FieldError>
          </div>
        );
      })}
      <FieldError>{error}</FieldError>
      <Button type="button" variant="outline" size="sm" onClick={() => onChange([...items, ""])}>
        <Plus aria-hidden="true" />
        {addLabel}
      </Button>
    </fieldset>
  );
}

export function JwksField({
  value,
  error,
  onChange,
}: {
  value: string;
  error?: string;
  onChange: (value: string) => void;
}) {
  const id = useId();
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>Public JWKS</Label>
      <Textarea
        id={id}
        rows={7}
        spellCheck={false}
        autoComplete="off"
        className="max-h-72 font-mono text-xs md:text-xs"
        placeholder={'{"keys":[{"kty":"OKP","crv":"Ed25519","x":"…","kid":"…"}]}'}
        value={value}
        aria-invalid={!!error}
        onChange={(event) => onChange(event.target.value)}
      />
      {error ? (
        <FieldError>{error}</FieldError>
      ) : (
        <p className="text-xs leading-5 text-muted-foreground">
          Ed25519 or P-256 public keys, up to five. To rotate, add the new key, deploy it, then
          remove the old one.
        </p>
      )}
    </div>
  );
}

/** Sign-in scopes as a checklist. `dense` drops the descriptions to one line. */
export function ScopeChecklist({ api, dense }: { api: DraftApi; dense?: boolean }) {
  const id = useId();
  return (
    <ul className="divide-y rounded-xl border">
      {oidcScopes.map((scope) => (
        <li key={scope.id} className={cn("flex items-start gap-3", dense ? "px-4 py-3" : "p-4")}>
          <Checkbox
            id={`${id}-${scope.id}`}
            checked={scope.required || api.draft.scopes.includes(scope.id)}
            disabled={scope.required}
            className="mt-0.5"
            onCheckedChange={(v) => api.toggleIn("scopes", scope.id, v === true)}
          />
          <div className="min-w-0 flex-1">
            <Label htmlFor={`${id}-${scope.id}`} className="cursor-pointer">
              {scope.label}
              <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] font-normal text-muted-foreground">
                {scope.id}
              </code>
            </Label>
            {!dense && (
              <p className="mt-1 text-xs leading-5 text-muted-foreground">{scope.description}</p>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

/** API scopes grouped by resource, with People / Itself columns when both flows are on. */
export function ApiScopePicker({
  api,
  locked,
  dense,
}: {
  api: DraftApi;
  locked: boolean;
  dense?: boolean;
}) {
  const id = useId();
  const { draft } = api;
  const lists: { key: "apiScopes" | "serviceScopes"; label: string }[] =
    draft.signIn && draft.serviceAccess
      ? [
          { key: "apiScopes", label: "People" },
          { key: "serviceScopes", label: "Itself" },
        ]
      : [{ key: draft.signIn ? "apiScopes" : "serviceScopes", label: "" }];
  return (
    <div className="space-y-3">
      {oidcResources.map((resource) => (
        <div key={resource.id} className="rounded-xl border">
          <label className="flex cursor-pointer items-start gap-3 p-4">
            <Checkbox
              checked={draft.resources.includes(resource.id)}
              disabled={locked}
              className="mt-0.5"
              onCheckedChange={(v) => api.toggleResource(resource.id, v === true)}
            />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium">{resource.label}</span>
              {!dense && (
                <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                  {resource.description}
                </span>
              )}
            </span>
          </label>
          <ul className="divide-y border-t bg-muted/30">
            {apiScopes
              .filter((scope) => scope.resource === resource.id)
              .map((scope) => (
                <li
                  key={scope.id}
                  className={cn("flex items-start gap-3 pr-4 pl-11", dense ? "py-2.5" : "py-3")}
                >
                  {lists.length === 1 && (
                    <Checkbox
                      id={`${id}-${scope.id}`}
                      checked={draft[lists[0]!.key].includes(scope.id)}
                      disabled={locked}
                      className="mt-0.5"
                      onCheckedChange={(v) => api.toggleIn(lists[0]!.key, scope.id, v === true)}
                    />
                  )}
                  <div className="min-w-0 flex-1">
                    <Label
                      htmlFor={lists.length === 1 ? `${id}-${scope.id}` : undefined}
                      className="cursor-pointer"
                    >
                      {scope.label}
                      <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] font-normal text-muted-foreground">
                        {scope.id}
                      </code>
                    </Label>
                    {!dense && (
                      <p className="mt-1 text-xs leading-5 text-muted-foreground">
                        {scope.description}
                      </p>
                    )}
                  </div>
                  {lists.length > 1 &&
                    lists.map((list) => (
                      <label
                        key={list.key}
                        className="flex cursor-pointer items-center gap-1.5 pt-0.5 text-xs text-muted-foreground"
                      >
                        <Checkbox
                          checked={draft[list.key].includes(scope.id)}
                          disabled={locked}
                          aria-label={`${scope.label}: ${list.label === "People" ? "for signed-in people" : "as itself"}`}
                          onCheckedChange={(v) => api.toggleIn(list.key, scope.id, v === true)}
                        />
                        {list.label}
                      </label>
                    ))}
                </li>
              ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

/** What saving would register, shown instead of calling the server. */
export function describeSave(draft: OidcClientDraft) {
  const normalized = normalizeClientDraft(draft);
  const r = clientRegistration(normalized);
  return {
    name: normalized.name,
    credential: normalized.credential,
    grants: r.grantTypes.join(", "),
    scopes: r.scopes.join(" "),
    serviceScopes: r.clientCredentialsScopes.join(" "),
    resources: r.resources.join(", ") || "none",
    apiCount: activeApiScopes(normalized).length,
  };
}

export function Section({
  id,
  title,
  description,
  children,
  className,
}: {
  id?: string;
  title: string;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section id={id} className={cn("scroll-mt-24 space-y-5", className)} aria-label={title}>
      <div>
        <h3 className="text-base font-semibold">{title}</h3>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {children}
    </section>
  );
}
