import { useId, useState, type ReactNode } from "react";
import { cn } from "cn";
import { ChevronDown, LoaderCircle } from "lucide-react";

export function Spinner() {
  return <LoaderCircle className="animate-spin" aria-hidden="true" />;
}

function PanelTitle({ title, count }: { title: string; count?: number }) {
  return (
    <>
      {title}
      {count !== undefined && (
        <span className="text-sm font-medium tabular-nums text-muted-foreground">{count}</span>
      )}
    </>
  );
}

/** A card with a title row, an optional action on the right, and a body under a divider. */
export function Panel({
  title,
  count,
  action,
  children,
}: {
  title: string;
  count?: number;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="flex min-w-0 flex-col overflow-hidden rounded-2xl border bg-card">
      <div className="flex min-h-16 items-center justify-between gap-3 px-5 py-3">
        <h2 className="flex items-baseline gap-2 text-base font-semibold tracking-tight">
          <PanelTitle title={title} count={count} />
        </h2>
        {action}
      </div>
      <div className="flex-1 border-t">{children}</div>
    </section>
  );
}

/** A panel that starts closed; its whole title row opens and closes it. */
export function CollapsiblePanel({
  title,
  count,
  disabled = false,
  children,
}: {
  title: string;
  count?: number;
  disabled?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <section className="min-w-0 overflow-hidden rounded-2xl border bg-card">
      <h2>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={id}
          disabled={disabled}
          onClick={() => setOpen((value) => !value)}
          className="flex min-h-16 w-full items-center gap-2 px-5 py-3 text-left text-base font-semibold tracking-tight transition-colors duration-150 outline-none hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset disabled:hover:bg-transparent"
        >
          <PanelTitle title={title} count={count} />
          {!disabled && (
            <ChevronDown
              className={cn(
                "ml-auto size-5 text-muted-foreground transition-transform duration-200 ease-out motion-reduce:transition-none",
                open && "rotate-180",
              )}
              aria-hidden="true"
            />
          )}
        </button>
      </h2>
      {/* Animating the grid track tweens the height without measuring it. */}
      <div
        id={id}
        inert={!open}
        className={cn(
          "grid transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none",
          open ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
        )}
      >
        <div className="min-h-0 overflow-hidden">
          <div className="border-t">{children}</div>
        </div>
      </div>
    </section>
  );
}
