import { useEffect, useState } from "react";

const dateTime = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" });
const relative = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

export const shortDate = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

/** "in 6 days", "3 hours ago": the largest unit that fits. */
export function fromNow(date: Date) {
  const seconds = (date.getTime() - Date.now()) / 1000;
  for (const [unit, size] of [
    ["day", 86_400],
    ["hour", 3_600],
    ["minute", 60],
  ] as const) {
    if (Math.abs(seconds) >= size) return relative.format(Math.round(seconds / size), unit);
  }
  return relative.format(Math.round(seconds), "second");
}

/** True once the page runs in the browser, where the local time zone and clock are known. */
function useMounted() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted;
}

/**
 * A date in the reader's time zone, optionally with how far away it is. The server renders it
 * in UTC first, since it can't know the reader's zone, and the browser swaps in local time.
 */
export function LocalTime({ value, withRelative }: { value: Date; withRelative?: boolean }) {
  const mounted = useMounted();
  const date = new Date(value);
  return (
    <time dateTime={date.toISOString()} className="text-sm">
      {mounted ? dateTime.format(date) : date.toISOString().slice(0, 16).replace("T", " ")}
      {mounted && withRelative && <span className="text-muted-foreground"> · {fromNow(date)}</span>}
    </time>
  );
}

/** "5 minutes ago", shown once mounted so the server and the browser render the same text. */
export function TimeAgo({ value }: { value: Date }) {
  return useMounted() ? fromNow(new Date(value)) : null;
}
