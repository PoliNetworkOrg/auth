import { useState } from "react";
import { cn } from "cn";
import { clientInitials } from "@/auth/oidc-clients";

export function AppLogo({
  name,
  logo,
  logoDark,
  className,
}: {
  name: string;
  logo?: string | null;
  /** Replaces `logo` in dark mode; ignored without a working `logo`. */
  logoDark?: string | null;
  className?: string;
}) {
  // Remembers which URLs failed, so a corrected URL is tried again.
  const [failed, setFailed] = useState<string[]>([]);
  const showLogo = !!logo && !failed.includes(logo);
  const showDark = showLogo && !!logoDark && !failed.includes(logoDark);
  return (
    <div
      aria-hidden="true"
      className={cn(
        "flex size-11 shrink-0 items-center justify-center",
        // A loaded logo stands on its own; only the initials sit in a tile.
        !showLogo &&
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
            className={cn("size-full object-contain", showDark && "dark:hidden")}
            onError={() => setFailed((urls) => [...urls, logo])}
          />
          {/* The theme switches by class, so both load and CSS picks one without a flash. */}
          {showDark && (
            <img
              key={logoDark}
              src={logoDark}
              alt=""
              referrerPolicy="no-referrer"
              className="hidden size-full object-contain dark:block"
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
