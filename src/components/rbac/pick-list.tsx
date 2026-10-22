import { useId, useState } from "react";
import { cn } from "cn";
import { Search } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";

export type PickOption = {
  key: string;
  label: string;
  hint?: string;
  disabled?: boolean;
  disabledReason?: string;
  status?: "Inherited" | "Direct" | "Override" | "Implied";
  statusHint?: string;
  action?: { label: string; onClick: () => void; disabled?: boolean };
};

const SEARCHABLE_FROM = 8;

/** A searchable checkbox list for choosing keys, used for both hierarchies and grants. */
export function PickList({
  legend,
  description,
  options,
  selected,
  onChange,
  emptyText,
  error,
}: {
  legend: string;
  description: string;
  options: PickOption[];
  selected: string[];
  onChange: (next: string[]) => void;
  emptyText: string;
  error?: string;
}) {
  const [query, setQuery] = useState("");
  const searchId = useId();
  const errorId = useId();
  const term = query.trim().toLowerCase();
  const visible = term
    ? options.filter(
        (option) =>
          option.key.toLowerCase().includes(term) || option.label.toLowerCase().includes(term),
      )
    : options;

  function toggle(key: string, checked: boolean) {
    onChange(checked ? [...new Set([...selected, key])] : selected.filter((item) => item !== key));
  }

  return (
    <fieldset className="space-y-3">
      <legend className="text-sm font-medium">{legend}</legend>
      <p className="text-xs leading-5 text-muted-foreground">{description}</p>
      {options.length >= SEARCHABLE_FROM && (
        <div className="relative">
          <Search
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            id={searchId}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={`Filter ${legend.toLowerCase()}`}
            aria-label={`Filter ${legend.toLowerCase()}`}
            className="pl-9"
          />
        </div>
      )}
      <div
        className={cn(
          "max-h-72 divide-y overflow-y-auto rounded-xl border",
          error && "border-destructive",
        )}
        aria-describedby={error ? errorId : undefined}
      >
        {visible.length === 0 ? (
          <p className="px-4 py-6 text-center text-xs text-muted-foreground">
            {options.length === 0 ? emptyText : "Nothing matches that filter."}
          </p>
        ) : (
          visible.map((option) => {
            const checked = selected.includes(option.key);
            return (
              <div
                key={option.key}
                data-permission-state={option.status?.toLowerCase()}
                className={cn(
                  "flex items-start gap-3 px-4 py-3 transition-colors",
                  option.status === "Override" && "bg-amber-500/10 border-l-2 border-l-amber-500",
                  !option.disabled && "hover:bg-accent/50",
                )}
              >
                <label
                  className={cn(
                    "flex min-w-0 flex-1 cursor-pointer items-start gap-3",
                    option.disabled && "cursor-not-allowed opacity-60",
                  )}
                >
                  <Checkbox
                    className="mt-0.5"
                    checked={checked}
                    disabled={option.disabled}
                    onCheckedChange={(value) => toggle(option.key, value === true)}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                      <span className="text-sm font-medium">{option.label}</span>
                      <code className="font-mono text-xs text-muted-foreground">{option.key}</code>
                      {option.status && (
                        <span
                          className={cn(
                            "rounded border px-1.5 py-0.5 text-xs",
                            option.status === "Override"
                              ? "border-amber-500/50 font-medium text-amber-800 dark:text-amber-300"
                              : option.status === "Inherited"
                                ? "border-primary/30 bg-primary/10 text-primary"
                                : "text-muted-foreground",
                          )}
                        >
                          {option.status}
                        </span>
                      )}
                    </span>
                    {option.hint && (
                      <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">
                        {option.hint}
                      </span>
                    )}
                    {option.statusHint && (
                      <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">
                        {option.statusHint}
                      </span>
                    )}
                    {option.disabled && option.disabledReason && (
                      <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">
                        {option.disabledReason}
                      </span>
                    )}
                  </span>
                </label>
                {option.action && (
                  <button
                    type="button"
                    className="shrink-0 rounded px-1 text-xs text-primary underline underline-offset-4 focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
                    disabled={option.action.disabled}
                    aria-label={`${option.action.label} for ${option.label}`}
                    onClick={option.action.onClick}
                  >
                    {option.action.label}
                  </button>
                )}
              </div>
            );
          })
        )}
      </div>
      {error && (
        <p id={errorId} role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </fieldset>
  );
}
