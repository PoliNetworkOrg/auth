import { useState } from "react";
import { cn } from "cn";
import { clientInitials } from "@/auth/oidc-clients";

export function AppLogo({
  name,
  logo,
  className,
}: {
  name: string;
  logo?: string | null;
  className?: string;
}) {
  // Remembers which URL failed, so a corrected URL is tried again.
  const [failedLogo, setFailedLogo] = useState<string | null>(null);
  return (
    <div
      aria-hidden="true"
      className={cn(
        "flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-xl border bg-background text-sm font-semibold text-primary",
        className,
      )}
    >
      {logo && logo !== failedLogo ? (
        <img
          key={logo}
          src={logo}
          alt=""
          referrerPolicy="no-referrer"
          className="size-full object-cover"
          onError={() => setFailedLogo(logo)}
        />
      ) : (
        clientInitials(name)
      )}
    </div>
  );
}
