// Fields shared by the new-application wizard and the application settings page.
import { useId, useRef, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "cn";
import { Plus, Trash2 } from "lucide-react";
import {
  apiScopes,
  oidcResources,
  oidcScopes,
  type OidcApplicationType,
  type OidcClientCredential,
} from "@/auth/oidc-clients";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { ClientDraftApi } from "./use-client-draft";

export function RequiredMark() {
  return (
    <span aria-hidden="true" className="text-destructive">
      *
    </span>
  );
}

export function FieldError({ id, children }: { id?: string; children?: string }) {
  if (!children) return null;
  return (
    <p id={id} role="alert" className="text-xs leading-5 text-destructive">
      {children}
    </p>
  );
}

export function FieldLabel({
  htmlFor,
  required,
  children,
}: {
  htmlFor?: string;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <Label htmlFor={htmlFor} className="gap-1">
      {children}
      {required && <RequiredMark />}
    </Label>
  );
}

export function TextField({
  label,
  value,
  onChange,
  required,
  hint,
  error,
  placeholder,
  inputMode = "url",
  maxLength,
  autoComplete = "off",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  hint?: string;
  error?: string;
  placeholder?: string;
  inputMode?: "url" | "text";
  maxLength?: number;
  autoComplete?: string;
}) {
  const id = useId();
  return (
    <div className="space-y-2">
      <FieldLabel htmlFor={id} required={required}>
        {label}
      </FieldLabel>
      <Input
        id={id}
        value={value}
        inputMode={inputMode}
        maxLength={maxLength}
        autoComplete={autoComplete}
        spellCheck={false}
        placeholder={placeholder}
        aria-required={required || undefined}
        aria-invalid={!!error}
        aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
        onChange={(event) => onChange(event.target.value)}
      />
      {error ? (
        <FieldError id={`${id}-error`}>{error}</FieldError>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-xs leading-5 text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/** An editable list of URIs or emails, one input per row. */
export function ListField({
  label,
  items,
  onChange,
  addLabel,
  placeholder,
  required,
  hint,
  error,
  itemErrors,
  minItems = 0,
  type = "url",
}: {
  label: string;
  items: string[];
  onChange: (items: string[]) => void;
  addLabel: string;
  placeholder: string;
  required?: boolean;
  hint?: ReactNode;
  error?: string;
  itemErrors?: (string | null)[];
  minItems?: number;
  type?: "url" | "email";
}) {
  const id = useId();
  return (
    <fieldset className="space-y-2" aria-required={required || undefined}>
      <legend className="flex items-center gap-1 text-sm leading-none font-medium">
        {label}
        {required && <RequiredMark />}
      </legend>
      {hint && <p className="text-xs leading-5 text-muted-foreground">{hint}</p>}
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
            <FieldError id={`${inputId}-error`}>{itemError}</FieldError>
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

const jsonToken =
  /("(?:\\.|[^"\\])*")(?=\s*:)|("(?:\\.|[^"\\])*"?)|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|\btrue\b|\bfalse\b|\bnull\b)|([{}[\],:])/g;

/** JSON coloured by token. Anything it doesn't recognise renders plain, so it never drops text. */
function JsonTokens({ source }: { source: string }) {
  const parts: ReactNode[] = [];
  let end = 0;
  for (const match of source.matchAll(jsonToken)) {
    if (match.index > end) parts.push(source.slice(end, match.index));
    const [text, key, string, literal] = match;
    const tone = key
      ? "text-primary"
      : string
        ? "text-emerald-700 dark:text-emerald-300"
        : literal
          ? "text-amber-700 dark:text-amber-300"
          : "text-muted-foreground";
    parts.push(
      <span key={match.index} className={tone}>
        {text}
      </span>,
    );
    end = match.index + text.length;
  }
  parts.push(source.slice(end));
  return parts;
}

const indentUnit = "  ";

/** Replaces part of a textarea's text the way typing would, so undo still works. */
function replaceText(textarea: HTMLTextAreaElement, from: number, to: number, text: string) {
  textarea.setSelectionRange(from, to);
  if (document.execCommand("insertText", false, text)) return;
  textarea.setRangeText(text, from, to, "end");
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
}

/**
 * Editor keys for JSON in a textarea: Enter keeps the line's indentation (one level more
 * after an opening bracket), Tab and Shift+Tab indent and outdent the selected lines.
 */
function handleJsonKey(event: KeyboardEvent<HTMLTextAreaElement>) {
  if (event.nativeEvent.isComposing) return;
  const textarea = event.currentTarget;
  const { value, selectionStart: start, selectionEnd: end } = textarea;
  const lineStart = value.lastIndexOf("\n", start - 1) + 1;

  if (event.key === "Enter" && !event.shiftKey && !event.metaKey && !event.ctrlKey) {
    event.preventDefault();
    const indent = /^ */.exec(value.slice(lineStart))![0];
    const before = value.slice(0, start).trimEnd().at(-1);
    const after = value.slice(end).trimStart()[0];
    const opens = before === "{" || before === "[";
    if (!opens) return replaceText(textarea, start, end, `\n${indent}`);
    const inner = `\n${indent}${indentUnit}`;
    // Between a pair of brackets, the closing one moves to its own line below the caret.
    const closes = (before === "{" && after === "}") || (before === "[" && after === "]");
    const closeAt = closes ? value.indexOf(after, end) : end;
    replaceText(textarea, start, closeAt, closes ? `${inner}\n${indent}` : inner);
    textarea.setSelectionRange(start + inner.length, start + inner.length);
    return;
  }

  if (event.key === "Tab" && !event.metaKey && !event.ctrlKey && !event.altKey) {
    event.preventDefault();
    const multiline = value.slice(start, end).includes("\n");
    if (!event.shiftKey && !multiline) return replaceText(textarea, start, end, indentUnit);
    const blockEnd = value.indexOf("\n", end - (end > start ? 1 : 0));
    const to = blockEnd === -1 ? value.length : blockEnd;
    const lines = value.slice(lineStart, to).split("\n");
    const changed = lines.map((line) =>
      event.shiftKey ? line.replace(/^ {1,2}/, "") : indentUnit + line,
    );
    const text = changed.join("\n");
    if (text === value.slice(lineStart, to)) return;
    replaceText(textarea, lineStart, to, text);
    const shift = changed[0]!.length - lines[0]!.length;
    if (multiline) textarea.setSelectionRange(lineStart, lineStart + text.length);
    else {
      const caret = Math.max(lineStart, start + shift);
      textarea.setSelectionRange(caret, caret);
    }
  }
}

export function JwksField({
  value,
  onChange,
  error,
}: {
  value: string;
  onChange: (value: string) => void;
  error?: string;
}) {
  const id = useId();
  // Tab indents inside the field. Escape hands the next Tab back to the page, so keyboard
  // users can still leave.
  const tabLeaves = useRef(false);
  return (
    <div className="space-y-2">
      <FieldLabel htmlFor={id} required>
        Public JWKS
      </FieldLabel>
      {/* The textarea sits transparent over a highlighted copy of its text, so editing,
          undo and selection stay native. Both share one grid cell and grow together; the
          wrapper scrolls them as one. */}
      <div className="grid max-h-80 overflow-auto rounded-md border border-input bg-transparent shadow-xs transition-[color,box-shadow] focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50 has-aria-invalid:border-destructive has-aria-invalid:ring-destructive/20 dark:bg-input/30 dark:has-aria-invalid:ring-destructive/40">
        <pre
          aria-hidden="true"
          className="pointer-events-none col-start-1 row-start-1 m-0 px-3 py-2 font-mono text-xs leading-5 wrap-anywhere whitespace-pre-wrap"
        >
          <JsonTokens source={value} />
          {/* Keeps a trailing newline's empty line as tall as the textarea's. */}{" "}
        </pre>
        <textarea
          id={id}
          rows={8}
          spellCheck={false}
          autoComplete="off"
          className="col-start-1 row-start-1 field-sizing-content resize-none overflow-hidden bg-transparent px-3 py-2 font-mono text-xs leading-5 wrap-anywhere whitespace-pre-wrap text-transparent caret-foreground outline-none placeholder:text-muted-foreground"
          placeholder={'{"keys":[{"kty":"OKP","crv":"Ed25519","x":"…","kid":"…"}]}'}
          value={value}
          aria-required
          aria-invalid={!!error}
          aria-describedby={error ? `${id}-hint ${id}-error` : `${id}-hint`}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              tabLeaves.current = true;
              return;
            }
            const leaving = tabLeaves.current && event.key === "Tab";
            if (event.key !== "Shift") tabLeaves.current = false;
            if (!leaving) handleJsonKey(event);
          }}
        />
      </div>
      <p id={`${id}-hint`} className="text-xs leading-5 text-muted-foreground">
        Ed25519 or P-256 public keys, up to five. To rotate, add the new key, deploy its private
        key, then remove the old one. Tab indents; press Esc, then Tab, to move on.
      </p>
      {error && <FieldError id={`${id}-error`}>{error}</FieldError>}
    </div>
  );
}

/** A setting that is on or off: what it does on the left, the switch on the right. */
export function SwitchRow({
  title,
  description,
  checked,
  onCheckedChange,
  disabled,
}: {
  title: string;
  description: ReactNode;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="flex items-start justify-between gap-6">
      <div className="min-w-0">
        <Label htmlFor={id} className={cn(!disabled && "cursor-pointer")}>
          {title}
        </Label>
        <p id={`${id}-description`} className="mt-1 text-xs leading-5 text-muted-foreground">
          {description}
        </p>
      </div>
      <Switch
        id={id}
        checked={checked}
        disabled={disabled}
        aria-describedby={`${id}-description`}
        className="mt-0.5"
        onCheckedChange={onCheckedChange}
      />
    </div>
  );
}

const redirectRules: { id: OidcApplicationType; title: string; description: string }[] = [
  {
    id: "web",
    title: "Public https URLs only",
    description: "For websites. Every redirect must be https on a public host.",
  },
  {
    id: "native",
    title: "Also localhost and app schemes",
    description:
      "For mobile, desktop and CLI apps, or local development: http://localhost, http://127.0.0.1, http://[::1], and schemes like org.polinetwork.app:/callback.",
  },
];

/** The redirect rules the client registers with, which is all the application type changes. */
export function RedirectRule({
  value,
  onChange,
  compact,
}: {
  value: OidcApplicationType;
  onChange: (value: OidcApplicationType) => void;
  /** A two-way switch with only the chosen rule explained, for the settings page. */
  compact?: boolean;
}) {
  const name = useId();
  if (compact) {
    const chosen = redirectRules.find((rule) => rule.id === value)!;
    return (
      <fieldset className="space-y-2">
        <legend className="text-sm leading-none font-medium">Allowed redirect URIs</legend>
        <div className="mt-3 grid grid-cols-2 gap-1 rounded-lg border bg-muted/50 p-1">
          {redirectRules.map((rule) => (
            <label
              key={rule.id}
              className={cn(
                "flex min-h-9 items-center justify-center rounded-md px-2 py-1 text-center text-sm leading-tight font-medium transition-colors has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/50",
                value === rule.id
                  ? "bg-background text-foreground shadow-sm ring-1 ring-border dark:bg-input/60"
                  : "cursor-pointer text-muted-foreground hover:text-foreground",
              )}
            >
              <input
                type="radio"
                name={name}
                value={rule.id}
                checked={value === rule.id}
                className="sr-only"
                onChange={() => onChange(rule.id)}
              />
              {rule.title}
            </label>
          ))}
        </div>
        <p className="text-xs leading-5 text-muted-foreground">{chosen.description}</p>
      </fieldset>
    );
  }
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm leading-none font-medium">Allowed redirect URIs</legend>
      <div className="mt-3 grid gap-2">
        {redirectRules.map((rule) => (
          <label
            key={rule.id}
            className={cn(
              "flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/50",
              value === rule.id ? "border-primary bg-primary/5" : "hover:bg-accent/50",
            )}
          >
            <input
              type="radio"
              name={name}
              value={rule.id}
              checked={value === rule.id}
              onChange={() => onChange(rule.id)}
              className="mt-0.5 size-4 shrink-0 cursor-pointer appearance-none rounded-full border border-input bg-background transition-[border-width,border-color] outline-none checked:border-[5px] checked:border-primary"
            />
            <span className="min-w-0">
              <span className="block text-sm font-medium">{rule.title}</span>
              <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">
                {rule.description}
              </span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** What a signed-in person is asked to share with the app. */
export function IdentityScopeList({
  api,
  legend,
  dense,
}: {
  api: ClientDraftApi;
  legend: string;
  /** One line per scope, without descriptions, for the settings page. */
  dense?: boolean;
}) {
  const id = useId();
  return (
    <fieldset className="space-y-3">
      <legend className="text-sm leading-none font-medium">{legend}</legend>
      <ul className="mt-3 divide-y rounded-lg border">
        {oidcScopes.map((scope) => {
          const checkboxId = `${id}-${scope.id}`;
          return (
            <li key={scope.id}>
              <label
                htmlFor={checkboxId}
                title={dense ? scope.description : undefined}
                className={cn(
                  "flex gap-3 px-4",
                  dense ? "items-center py-2.5" : "items-start py-3",
                  !scope.required && "cursor-pointer",
                )}
              >
                <Checkbox
                  id={checkboxId}
                  checked={scope.required || api.draft.scopes.includes(scope.id)}
                  disabled={scope.required}
                  className={dense ? undefined : "mt-0.5"}
                  onCheckedChange={(value) => api.toggleScope("scopes", scope.id, value === true)}
                />
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2 text-sm font-medium">
                    {scope.label}
                    <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] font-normal text-muted-foreground">
                      {scope.id}
                    </code>
                  </span>
                  {!dense && (
                    <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                      {scope.description}
                    </span>
                  )}
                </span>
              </label>
            </li>
          );
        })}
      </ul>
    </fieldset>
  );
}

/**
 * PoliNetwork API scopes for one ceiling: `apiScopes` for the people the app signs in,
 * `serviceScopes` for the app itself. Grouped by the API they belong to.
 */
export function ApiScopeList({
  api,
  list,
  legend,
  required,
  locked,
  error,
}: {
  api: ClientDraftApi;
  list: "apiScopes" | "serviceScopes";
  legend: string;
  required?: boolean;
  locked: boolean;
  error?: string;
}) {
  const id = useId();
  return (
    <fieldset className="space-y-3" aria-required={required || undefined}>
      <legend className="flex items-center gap-1 text-sm leading-none font-medium">
        {legend}
        {required && <RequiredMark />}
      </legend>
      {locked && (
        <p className="text-xs leading-5 text-muted-foreground">
          Only Master Admin can change API access.
        </p>
      )}
      <div className="mt-3 divide-y rounded-lg border">
        {oidcResources.map((resource) => (
          <div key={resource.id}>
            <p className="bg-muted/40 px-4 py-2 text-xs font-medium text-muted-foreground">
              {resource.label}
            </p>
            <ul className="divide-y">
              {apiScopes
                .filter((scope) => scope.resource === resource.id)
                .map((scope) => {
                  const checkboxId = `${id}-${scope.id}`;
                  return (
                    <li key={scope.id}>
                      <label
                        htmlFor={checkboxId}
                        className={cn(
                          "flex items-start gap-3 px-4 py-3",
                          !locked && "cursor-pointer",
                        )}
                      >
                        <Checkbox
                          id={checkboxId}
                          checked={api.draft[list].includes(scope.id)}
                          disabled={locked}
                          className="mt-0.5"
                          onCheckedChange={(value) =>
                            api.toggleScope(list, scope.id, value === true)
                          }
                        />
                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-center gap-2 text-sm font-medium">
                            {scope.label}
                            <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] font-normal text-muted-foreground">
                              {scope.id}
                            </code>
                          </span>
                          <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                            {scope.description}
                          </span>
                        </span>
                      </label>
                    </li>
                  );
                })}
            </ul>
          </div>
        ))}
      </div>
      <FieldError>{error}</FieldError>
    </fieldset>
  );
}

export const credentialInfo: Record<OidcClientCredential, { title: string; description: string }> =
  {
    secret: {
      title: "Client secret",
      description: "The app's server keeps a secret we generate. It is shown once.",
    },
    "private-key": {
      title: "Private key",
      description:
        "The app signs its requests with its own key. You register only the public JWKS.",
    },
    public: {
      title: "Public",
      description: "The app runs in the browser or on a device and can't keep a secret. Uses PKCE.",
    },
  };

/** What saving does to the credentials the app uses now. */
export function credentialChangeNote(from: OidcClientCredential, to: OidcClientCredential) {
  if (from === to) return null;
  if (to === "secret") return "A new client secret is issued when you save. It is shown once.";
  if (to === "private-key")
    return "The current secret stops working when you save. The app must sign with its key.";
  return from === "secret"
    ? "The current secret stops working when you save. The app must use PKCE."
    : "The registered keys stop working when you save. The app must use PKCE.";
}

/**
 * Every PoliNetwork API scope in one compact table, with a column per ceiling the app uses:
 * for the people it signs in, and as itself.
 */
export function ApiAccessTable({
  api,
  locked,
  error,
}: {
  api: ClientDraftApi;
  locked: boolean;
  error?: string;
}) {
  const id = useId();
  const { draft } = api;
  const columns = [
    ...(draft.signIn ? [{ list: "apiScopes" as const, label: "For people" }] : []),
    ...(draft.serviceAccess ? [{ list: "serviceScopes" as const, label: "As itself" }] : []),
  ];
  if (!columns.length) return null;
  return (
    <div className="space-y-3">
      {locked && (
        <p className="text-xs leading-5 text-muted-foreground">
          Only Master Admin can change API access.
        </p>
      )}
      <table className="w-full text-sm">
        <caption className="sr-only">PoliNetwork API scopes</caption>
        <thead>
          <tr>
            <td />
            {columns.map((column) => (
              <th
                key={column.list}
                scope="col"
                className="w-24 pb-1 text-center text-xs font-medium text-muted-foreground"
              >
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        {oidcResources.map((resource) => (
          <tbody key={resource.id} className="border-b last:border-b-0">
            <tr>
              <th
                scope="rowgroup"
                colSpan={columns.length + 1}
                className="pt-4 pb-2 text-left text-xs font-medium text-muted-foreground"
              >
                {resource.label}
              </th>
            </tr>
            {apiScopes
              .filter((scope) => scope.resource === resource.id)
              .map((scope) => (
                <tr key={scope.id} title={scope.description} className="border-t">
                  <th scope="row" className="py-2.5 pr-3 text-left font-normal">
                    <span className="flex flex-wrap items-center gap-2">
                      {scope.label}
                      <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
                        {scope.id}
                      </code>
                    </span>
                  </th>
                  {columns.map((column) => (
                    <td key={column.list} className="py-1 text-center">
                      <label
                        htmlFor={`${id}-${column.list}-${scope.id}`}
                        className={cn(
                          "inline-flex size-10 items-center justify-center rounded-md",
                          !locked && "cursor-pointer hover:bg-accent/50",
                        )}
                      >
                        <Checkbox
                          id={`${id}-${column.list}-${scope.id}`}
                          checked={draft[column.list].includes(scope.id)}
                          disabled={locked}
                          aria-label={`${scope.label}, ${column.label.toLowerCase()}`}
                          onCheckedChange={(value) =>
                            api.toggleScope(column.list, scope.id, value === true)
                          }
                        />
                      </label>
                    </td>
                  ))}
                </tr>
              ))}
          </tbody>
        ))}
      </table>
      <FieldError>{error}</FieldError>
    </div>
  );
}
