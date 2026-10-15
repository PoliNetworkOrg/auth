import { useRef, type ReactNode } from "react";
import { Search, X } from "lucide-react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

/** The search box on its own, for pages that lay out the rest of the toolbar themselves. */
export function SearchField({
  kind,
  query,
  onQueryChange,
  className,
  inputClassName,
}: {
  kind: "roles" | "permissions";
  query: string;
  onQueryChange: (query: string) => void;
  className?: string;
  inputClassName?: string;
}) {
  const input = useRef<HTMLInputElement>(null);

  return (
    <div className={cn("relative min-w-0", className)}>
      <Search
        className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden="true"
      />
      <Input
        ref={input}
        type="search"
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
        placeholder={`Search ${kind}…`}
        aria-label={`Search ${kind}`}
        className={cn(
          "pr-10 pl-9 [&::-webkit-search-cancel-button]:appearance-none",
          inputClassName,
        )}
      />
      {query && (
        <Button
          variant="ghost"
          size="icon"
          className="absolute top-1/2 right-1 size-7 -translate-y-1/2 text-muted-foreground"
          aria-label="Clear search"
          onClick={() => {
            onQueryChange("");
            input.current?.focus();
          }}
        >
          <X className="size-3.5" aria-hidden="true" />
        </Button>
      )}
    </div>
  );
}

export function CatalogSearch({
  kind,
  query,
  onQueryChange,
  count,
  total,
  children,
}: {
  kind: "roles" | "permissions";
  query: string;
  onQueryChange: (query: string) => void;
  count: number;
  total: number;
  children?: ReactNode;
}) {
  return (
    <Card className="flex flex-wrap items-center gap-3 p-5">
      <div className="flex min-w-0 flex-1 basis-64 flex-wrap items-center gap-3">
        <SearchField
          kind={kind}
          query={query}
          onQueryChange={onQueryChange}
          className="flex-1 basis-56 sm:max-w-lg"
        />
        <p role="status" className="text-xs whitespace-nowrap text-muted-foreground">
          {query.trim() ? `${count} of ${total}` : total} {kind}
        </p>
      </div>
      {children}
    </Card>
  );
}

export function CatalogSearchEmpty({ kind }: { kind: "roles" | "permissions" }) {
  return (
    <Card className="flex items-center gap-4 p-6">
      <div className="flex size-10 shrink-0 items-center justify-center rounded-xl border bg-background text-muted-foreground">
        <Search className="size-4" aria-hidden="true" />
      </div>
      <div>
        <h2 className="text-sm font-semibold">No {kind} match your search</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Try a different name, key, or description, or clear the search.
        </p>
      </div>
    </Card>
  );
}
