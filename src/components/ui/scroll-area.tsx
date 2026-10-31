import type { ComponentProps } from "react";
import { ScrollArea as ScrollAreaPrimitive } from "radix-ui";
import { cn } from "cn";

/** Styled scrollbars with native wheel, touch and keyboard scrolling. */
export function ScrollArea({
  children,
  className,
  viewportLabel,
  ...props
}: ComponentProps<typeof ScrollAreaPrimitive.Root> & { viewportLabel?: string }) {
  return (
    <ScrollAreaPrimitive.Root
      data-slot="scroll-area"
      type="auto"
      className={cn("relative overflow-hidden", className)}
      {...props}
    >
      <ScrollAreaPrimitive.Viewport
        data-slot="scroll-area-viewport"
        role="region"
        aria-label={viewportLabel}
        tabIndex={0}
        className="size-full max-h-[inherit] rounded-[inherit] outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:ring-inset"
      >
        {children}
      </ScrollAreaPrimitive.Viewport>
      <ScrollBar />
      <ScrollBar orientation="horizontal" />
      <ScrollAreaPrimitive.Corner className="bg-muted" />
    </ScrollAreaPrimitive.Root>
  );
}

function ScrollBar({
  className,
  orientation = "vertical",
  ...props
}: ComponentProps<typeof ScrollAreaPrimitive.Scrollbar>) {
  return (
    <ScrollAreaPrimitive.Scrollbar
      data-slot="scroll-area-scrollbar"
      orientation={orientation}
      className={cn(
        "flex touch-none bg-muted p-0.5 select-none",
        orientation === "vertical" ? "h-full w-2.5" : "h-2.5 flex-col",
        className,
      )}
      {...props}
    >
      <ScrollAreaPrimitive.Thumb className="relative flex-1 rounded-full bg-muted-foreground hover:bg-foreground" />
    </ScrollAreaPrimitive.Scrollbar>
  );
}
