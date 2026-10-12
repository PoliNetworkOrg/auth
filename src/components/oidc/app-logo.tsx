import { useState } from "react";
import { cn } from "cn";
import { clientInitials } from "@/auth/oidc-clients";

export function AppLogo({
  name,
  logo,
  logoDark,
  bare = false,
  className,
}: {
  name: string;
  logo?: string | null;
  /** Replaces `logo` in dark mode; ignored without a working `logo`. */
  logoDark?: string | null;
  /** Draws a loaded logo on its own, without the tile; initials keep it. */
  bare?: boolean;
  className?: string;
}) {
  // Remembers which URLs failed, so a corrected URL is tried again.
  const [failed, setFailed] = useState<string[]>([]);
  const showLogo = !!logo && !failed.includes(logo);
  const showDark = showLogo && !!logoDark && !failed.includes(logoDark);
  // Logos are drawn to their own edges, so the tile leaves a margin around them.
  const imageClass = cn("object-contain", bare ? "size-full" : "size-[64%]");
  return (
    <div
      aria-hidden="true"
      className={cn(
        "flex size-11 shrink-0 items-center justify-center",
        !(bare && showLogo) &&
          "overflow-hidden rounded-xl border bg-background text-sm font-semibold text-primary",
        className,
      )}
    >
      {showLogo ? (
        <>
          <img
            key={logo}
            src={logo}
            alt=""
            referrerPolicy="no-referrer"
            className={cn(imageClass, showDark && "dark:hidden")}
            onError={() => setFailed((urls) => [...urls, logo])}
          />
          {/* The theme switches by class, so both load and CSS picks one without a flash. */}
          {showDark && (
            <img
              key={logoDark}
              src={logoDark}
              alt=""
              referrerPolicy="no-referrer"
              className={cn(imageClass, "hidden dark:block")}
              onError={() => setFailed((urls) => [...urls, logoDark])}
            />
          )}
        </>
      ) : (
        clientInitials(name)
      )}
    </div>
  );
}
