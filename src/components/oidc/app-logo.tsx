import { useState } from "react";
import { cn } from "cn";
import { clientInitials } from "@/auth/oidc-clients";

export function AppLogo({
  name,
  logo,
  bare = false,
  className,
}: {
  name: string;
  logo?: string | null;
  /** Draws a loaded logo on its own, without the tile; initials keep it. */
  bare?: boolean;
  className?: string;
}) {
  // Remembers which URL failed, so a corrected URL is tried again.
  const [failedLogo, setFailedLogo] = useState<string | null>(null);
  const showLogo = !!logo && logo !== failedLogo;
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
        <img
          key={logo}
          src={logo}
          alt=""
          referrerPolicy="no-referrer"
          // Logos are drawn to their own edges, so the tile leaves a margin around them.
          className={cn("object-contain", bare ? "size-full" : "size-[64%]")}
          onError={() => setFailedLogo(logo)}
        />
      ) : (
        clientInitials(name)
      )}
    </div>
  );
}
