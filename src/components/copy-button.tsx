import { useEffect, useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";

export function CopyButton({
  value,
  label,
  size = "icon-sm",
  className,
}: {
  value: string;
  label: string;
  size?: "icon-sm" | "icon-xs" | "sm";
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(timer);
  }, [copied]);
  return (
    <Button
      type="button"
      variant="ghost"
      size={size}
      className={className}
      aria-label={copied ? "Copied" : label}
      title={copied ? "Copied" : label}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
        } catch {
          /* Clipboard unavailable: the value stays visible for manual copy. */
        }
      }}
    >
      {copied ? <Check className="text-primary" aria-hidden="true" /> : <Copy aria-hidden="true" />}
      {size === "sm" && (copied ? "Copied" : "Copy")}
    </Button>
  );
}
