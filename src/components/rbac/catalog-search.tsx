import { useRef } from "react";
import { Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function CatalogSearch({
  kind,
  query,
  onQueryChange,
  count,
  total,
}: {
  kind: "roles" | "permissions";
  query: string;
  onQueryChange: (query: string) => void;
  count: number;
  total: number;
}) {
  const input = useRef<HTMLInputElement>(null);

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="relative min-w-0 flex-1 basis-64">
        <Search
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          ref={input}
          type="search"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="Search by name, key, or description"
          aria-label={`Search ${kind}`}
          className="pl-9"
        />
      </div>
      {query && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            onQueryChange("");
            input.current?.focus();
          }}
        >
          <X aria-hidden="true" />
          Clear search
        </Button>
      )}
      <p role="status" className="text-sm text-muted-foreground">
        {count} of {total} {kind}
      </p>
    </div>
  );
}
