import { Hint } from "@/components/ui/tooltip";
import { useEffect, useState } from "react";
import { cn } from "cn";
import { CopyButton } from "@/components/copy-button";

const FILLER = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** Matches the hide transition, so the stand-in returns as soon as the value is unreadable. */
const HIDE_MS = 100;

/**
 * A stand-in of the same length: letters and digits swapped for filler, spaces and punctuation
 * kept so it still reads like text under the blur. It depends only on the position, never on
 * the value, so it gives away nothing but the length and the layout.
 */
export function scramble(value: string) {
  return value.replace(/[A-Za-z0-9]/g, (_char, index: number) => {
    const mixed = Math.imul(index + 1, 2654435761) >>> 0;
    return FILLER[mixed % FILLER.length];
  });
}

function truncate(text: string, maxChars?: number) {
  return maxChars && text.length > maxChars ? `${text.slice(0, maxChars).trimEnd()}…` : text;
}

/**
 * Text that stays hidden until clicked, so a screen share or a screenshot doesn't leak it.
 * While hidden, the page holds only a scrambled stand-in, so lifting the blur shows nothing.
 * Copy works either way.
 */
export function SecretText({
  value,
  label,
  maxChars,
}: {
  value: string;
  label: string;
  /** Cuts the shown text after this many characters; copy still takes the whole value. */
  maxChars?: number;
}) {
  const [shown, setShown] = useState(false);
  // What the text holds and whether it is blurred change one after the other, so the blur can
  // tween: reveal swaps in the value while blurred, then sharpens it; hide blurs it first,
  // then swaps the stand-in back in.
  const [revealed, setRevealed] = useState(false);
  const [blurred, setBlurred] = useState(true);
  useEffect(() => {
    if (shown) {
      setRevealed(true);
      const frame = requestAnimationFrame(() => requestAnimationFrame(() => setBlurred(false)));
      return () => cancelAnimationFrame(frame);
    }
    setBlurred(true);
    const timer = setTimeout(() => setRevealed(false), HIDE_MS);
    return () => clearTimeout(timer);
  }, [shown]);

  return (
    <span className="inline-flex max-w-full min-w-0 items-center gap-1">
      <Hint content={shown ? "Click to hide" : "Click to reveal"}>
        <button
          type="button"
          aria-label={shown ? `Hide ${label}` : `Show ${label}`}

          onClick={() => setShown((value) => !value)}
          className="min-w-0 cursor-pointer rounded-sm text-left font-mono text-xs break-all select-none outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span
            aria-hidden={!revealed}
            className={cn(
              "transition-[filter,color] motion-reduce:transition-none",
              // The value leaves faster than it arrives.
              blurred
                ? "text-muted-foreground blur-[4px] duration-100 ease-in"
                : "text-foreground blur-0 duration-200 ease-out",
            )}
          >
            {truncate(revealed ? value : scramble(value), maxChars)}
          </span>
        </button>
      </Hint>
      <CopyButton value={value} label={`Copy ${label}`} className="shrink-0" />
    </span>
  );
}
