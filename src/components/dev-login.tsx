import { useEffect, useState } from "react";
import { FlaskConical, TriangleAlert } from "lucide-react";
import { cn } from "cn";
import { buttonVariants } from "@/components/ui/button";
import {
  DEV_LOGIN_KIND,
  DEV_LOGIN_PATH,
  devLoginHref,
  type DevLoginListing,
  type DevPersonaSummary,
} from "@/dev/shared";

/**
 * One-click sign-in as a test persona. Rendered only behind `import.meta.env.DEV`, and only
 * once the server confirms `DEV_LOGIN=1`, so it never appears in production.
 */
export function DevLoginPanel({ redirect }: { redirect: string }) {
  const [personas, setPersonas] = useState<DevPersonaSummary[]>([]);

  useEffect(() => {
    const controller = new AbortController();
    fetch(DEV_LOGIN_PATH, { signal: controller.signal })
      .then((response) => (response.ok ? (response.json() as Promise<DevLoginListing>) : null))
      .then((listing) => {
        if (listing?.kind === DEV_LOGIN_KIND) setPersonas(listing.personas);
      })
      .catch(() => {
        /* Dev sign-in is off: show nothing. */
      });
    return () => controller.abort();
  }, []);

  if (!personas.length) return null;
  return (
    <section
      aria-labelledby="dev-login-title"
      className="space-y-3 rounded-xl border border-dashed border-amber-500/60 bg-amber-500/5 p-4"
    >
      <div>
        <h2 id="dev-login-title" className="flex items-center gap-1.5 text-sm font-semibold">
          <FlaskConical className="size-4 text-amber-600 dark:text-amber-400" aria-hidden="true" />
          Dev sign-in
        </h2>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          Local development only. Signs you in as a test person, no account needed.
        </p>
      </div>
      <ul className="space-y-2">
        {personas.map((persona) => (
          <li key={persona.key}>
            <a
              href={devLoginHref(persona.key, redirect)}
              className={cn(
                buttonVariants({ variant: "outline" }),
                "h-auto w-full flex-col items-start gap-0.5 bg-card px-3 py-2 text-left whitespace-normal",
              )}
            >
              <span className="text-sm font-medium">{persona.name}</span>
              <span className="text-xs font-normal text-muted-foreground">
                {persona.description}
              </span>
              {persona.warning && (
                <span className="flex items-start gap-1 text-xs font-normal text-amber-700 dark:text-amber-300">
                  <TriangleAlert className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
                  {persona.warning}
                </span>
              )}
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
