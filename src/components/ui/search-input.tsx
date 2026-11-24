import { useRef, type ComponentProps } from "react";
import { X } from "lucide-react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/** A consistent clear control instead of the browser's search decoration. */
export function SearchInput({
  value,
  onValueChange,
  className,
  ...props
}: Omit<ComponentProps<typeof Input>, "type" | "value" | "onChange" | "ref"> & {
  value: string;
  onValueChange: (value: string) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <Input
        {...props}
        ref={input}
        type="search"
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
        onKeyDown={(event) => {
          props.onKeyDown?.(event);
          if (!event.defaultPrevented && !props.readOnly && event.key === "Escape") {
            event.preventDefault();
            onValueChange("");
          }
        }}
        className={cn("pr-10", className)}
      />
      {value && !props.disabled && !props.readOnly && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="absolute top-1/2 right-1 size-7 -translate-y-1/2 text-muted-foreground"
          aria-label="Clear search"
          onClick={() => {
            onValueChange("");
            input.current?.focus();
          }}
        >
          <X className="size-3.5" aria-hidden="true" />
        </Button>
      )}
    </>
  );
}
