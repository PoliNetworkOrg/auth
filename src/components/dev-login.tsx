import { useEffect, useId, useState } from "react";
import { FlaskConical, TriangleAlert } from "lucide-react";
import { cn } from "cn";
import { buttonVariants } from "@/components/ui/button";
import {
  DEV_LOGIN_KIND,
  DEV_LOGIN_PATH,
  devLoginHref,
  signedOAuthQuery,
  type DevLoginListing,
  type DevPersonaSummary,
} from "@/dev/shared";

/**
 * One-click sign-in as a test persona. Rendered only behind `import.meta.env.DEV`, and only
 * once the server confirms `DEV_LOGIN=1`, so it never appears in production. When an
 * application sent the person here, the page's signed OAuth query goes along, so the sign-in
 * continues that authorization instead of landing on `redirect`.
 */
export function DevLoginPanel({ redirect }: { redirect: string }) {
  const [personas, setPersonas] = useState<DevPersonaSummary[]>([]);
  const [oauthQuery, setOauthQuery] = useState<string>();
  const [open, setOpen] = useState(false);
  const listId = useId();

  useEffect(() => {
    // Read from the address bar as Better Auth's client does, so the signature still matches.
    setOauthQuery(signedOAuthQuery(window.location.search));
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
      className={cn(
        "absolute top-6 left-6 z-10 overflow-hidden rounded-xl border border-dashed border-amber-500/60 bg-amber-500/5 transition-[width] duration-300 ease-out motion-reduce:transition-none",
        open ? "w-[min(24rem,calc(100vw-3rem))]" : "w-12",
      )}
    >
      <h2 id="dev-login-title">
        <button
          type="button"
          aria-label={open ? "Collapse dev sign-in" : "Open dev sign-in"}
          aria-expanded={open}
          aria-controls={listId}
          onClick={() => setOpen((value) => !value)}
          className="flex h-12 w-full items-center gap-1.5 px-3.5 text-left text-sm font-semibold whitespace-nowrap outline-none hover:bg-amber-500/10 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
        >
          <FlaskConical
            className="size-4 shrink-0 text-amber-600 dark:text-amber-400"
            aria-hidden="true"
          />
          <span
            aria-hidden="true"
            className={cn(
              "transition-opacity duration-200 motion-reduce:transition-none",
              open ? "opacity-100" : "opacity-0",
            )}
          >
            Dev sign-in
          </span>
        </button>
      </h2>
      <div
        id={listId}
        inert={!open}
        className={cn(
          "grid transition-[grid-template-rows] duration-300 ease-out motion-reduce:transition-none",
          open ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
        )}
      >
        <div className="min-h-0 overflow-hidden">
          <ul className="space-y-2 px-4 pt-1 pb-4">
            {personas.map((persona) => (
              <li key={persona.key}>
                <a
                  href={devLoginHref(persona.key, redirect, oauthQuery)}
                  className={cn(
                    buttonVariants({ variant: "outline" }),
                    "h-auto w-full flex-col items-start gap-0.5 bg-card px-3 py-2 text-left whitespace-normal",
                  )}
                >
                  <span className="text-xs font-normal text-foreground">{persona.description}</span>
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
        </div>
      </div>
    </section>
  );
}
