import { type ReactNode } from "react";
import { Search } from "lucide-react";
import { cn } from "cn";
import { Card } from "@/components/ui/card";
import { SearchInput } from "@/components/ui/search-input";

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
  return (
    <div className={cn("relative min-w-0", className)}>
      <Search
        className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden="true"
      />
      <SearchInput
        value={query}
        onValueChange={onQueryChange}
        placeholder={`Search ${kind}…`}
        aria-label={`Search ${kind}`}
        className={cn("pr-10 pl-9", inputClassName)}
      />
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
          {query.trim() || count !== total ? `${count} of ${total}` : total} {kind}
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
