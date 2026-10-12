import { createFileRoute, Link } from "@tanstack/react-router";
import { z } from "zod";
import type { ReactNode } from "react";
import { cn } from "cn";
import { AppWindow, ExternalLink, Lambda, Plus, Users, type LucideIcon } from "lucide-react";
import { type OidcClientSummary } from "@/auth/oidc-clients";
import { getOidcClients } from "@/auth/oidc.functions";
import { accessOf, useAccess } from "@/components/access";
import { AppLogo } from "@/components/oidc/app-logo";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

const KINDS = [
  { value: undefined, label: "All", matches: () => true },
  {
    value: "sign-in",
    label: "Sign-in",
    matches: (client: OidcClientSummary) => client.grantTypes.includes("authorization_code"),
  },
  {
    value: "service",
    label: "Service",
    matches: (client: OidcClientSummary) => client.grantTypes.includes("client_credentials"),
  },
] as const;

export const Route = createFileRoute("/applications/")({
  // Filtering happens on the loaded list, so a change of kind does not refetch it.
  validateSearch: z.object({ kind: z.enum(["sign-in", "service"]).optional().catch(undefined) }),
  // Someone who may only register applications would be refused the list; the page points
  // them to the registration form instead.
  loader: ({ context }) =>
    accessOf(context.viewer).can("idp:applications:read") ? getOidcClients() : null,
  component: ApplicationsIndex,
});

/** A footer capability with a tooltip; struck through and dimmed when the app lacks it. */
function Capability({
  icon: Icon,
  available = true,
  label,
  className,
  children,
}: {
  icon: LucideIcon;
  available?: boolean;
  label: string;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {/* Sits above the card's stretched link so its tooltip shows on hover. */}
        <span
          className={cn(
            "relative z-10 flex items-center gap-1.5",
            !available && "text-muted-foreground/40",
            className,
          )}
        >
          <span className="relative">
            <Icon className="size-4" aria-hidden="true" />
            {!available && (
              // The wider card-coloured stroke cuts a gap in the icon around the slash.
              <svg
                viewBox="0 0 24 24"
                fill="none"
                strokeLinecap="round"
                className="absolute inset-0 size-4"
                aria-hidden="true"
              >
                <path d="m3 3 18 18" strokeWidth="5" className="stroke-card" />
                <path d="m3 3 18 18" strokeWidth="2" stroke="currentColor" />
              </svg>
            )}
          </span>
          <span className="sr-only">{label}</span>
          {children}
        </span>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

/** Narrows the list to apps that sign people in or that call APIs as themselves. */
function KindFilter({ clients }: { clients: OidcClientSummary[] }) {
  const { kind } = Route.useSearch();
  return (
    <div
      role="group"
      aria-label="Application kind"
      className="flex w-fit gap-1 rounded-lg border bg-card p-1"
    >
      {KINDS.map((option) => (
        <Button
          key={option.label}
          asChild
          variant={kind === option.value ? "secondary" : "ghost"}
          size="sm"
        >
          <Link
            from={Route.fullPath}
            search={{ kind: option.value }}
            replace
            aria-current={kind === option.value ? "true" : undefined}
          >
            {option.label}
            <span className="tabular-nums text-muted-foreground">
              {clients.filter(option.matches).length}
            </span>
          </Link>
        </Button>
      ))}
    </div>
  );
}

function ApplicationsIndex() {
  const { can } = useAccess();
  const canWrite = can("idp:applications:write");
  const clients = Route.useLoaderData();
  const { kind } = Route.useSearch();
  const shown = clients?.filter(KINDS.find((option) => option.value === kind)!.matches);

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">Applications</h1>
          <p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground">
            Services that sign people in with PoliNetwork Auth through OpenID Connect.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canWrite && (
            <Button asChild>
              <Link to="/applications/new">
                <Plus aria-hidden="true" />
                New application
              </Link>
            </Button>
          )}
        </div>
      </div>

      <div className="space-y-4">
        {!!clients?.length && <KindFilter clients={clients} />}
        {clients === null ? (
          <Card>
            <CardContent className="flex flex-col items-center gap-4 px-6 py-14 text-center">
              <div className="flex size-14 items-center justify-center rounded-2xl border bg-background text-primary">
                <AppWindow className="size-6" aria-hidden="true" />
              </div>
              <div>
                <h2 className="text-lg font-semibold">Register an application</h2>
                <p className="mt-2 max-w-sm text-sm leading-6 text-muted-foreground">
                  Your access covers registering applications. Ask an administrator for view access
                  to see the ones already registered.
                </p>
              </div>
              <Button asChild>
                <Link to="/applications/new">
                  <Plus aria-hidden="true" />
                  New application
                </Link>
              </Button>
            </CardContent>
          </Card>
        ) : clients.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center gap-4 px-6 py-14 text-center">
              <div className="flex size-14 items-center justify-center rounded-2xl border bg-background text-primary">
                <AppWindow className="size-6" aria-hidden="true" />
              </div>
              <div>
                <h2 className="text-lg font-semibold">No applications yet</h2>
                <p className="mt-2 max-w-sm text-sm leading-6 text-muted-foreground">
                  Register the first service that should offer “Sign in with PoliNetwork”. You'll
                  get a client ID and, if it uses one, a secret.
                </p>
              </div>
              {canWrite && (
                <Button asChild>
                  <Link to="/applications/new">
                    <Plus aria-hidden="true" />
                    New application
                  </Link>
                </Button>
              )}
            </CardContent>
          </Card>
        ) : !shown?.length ? (
          <Card>
            <CardContent className="px-6 py-10 text-center text-sm text-muted-foreground">
              {kind === "service"
                ? "No application calls APIs as itself."
                : "No application signs people in."}
            </CardContent>
          </Card>
        ) : (
          <ul
            className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
            aria-label="Applications"
          >
            {shown.map((client) => {
              // Apps that only call APIs as themselves have no one to count.
              const signsIn = client.grantTypes.includes("authorization_code");
              return (
                <li
                  key={client.clientId}
                  className="relative flex flex-col rounded-2xl border bg-card p-5 transition-colors hover:border-foreground/25 has-[a[data-card-link]:focus-visible]:border-ring"
                >
                  <div className="flex items-start justify-between gap-2">
                    <AppLogo
                      name={client.name}
                      logo={client.logo}
                      className={client.disabled ? "opacity-50 grayscale" : undefined}
                    />
                    {client.uri && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          {/* Sits above the card's stretched link so it opens the app, not its settings. */}
                          <Button
                            asChild
                            variant="ghost"
                            size="icon-sm"
                            className="relative z-10 -mt-1 -mr-1 text-muted-foreground"
                          >
                            <a
                              href={client.uri}
                              target="_blank"
                              rel="noreferrer"
                              aria-label={`Open ${client.name}`}
                            >
                              <ExternalLink aria-hidden="true" />
                            </a>
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Open {client.name}</TooltipContent>
                      </Tooltip>
                    )}
                  </div>
                  <div className="mt-4 mb-5 flex min-w-0 items-center gap-2">
                    <h2 className="truncate text-sm font-semibold">
                      <Link
                        to="/applications/$clientId"
                        params={{ clientId: client.clientId }}
                        data-card-link
                        className="outline-none after:absolute after:inset-0 after:rounded-2xl"
                      >
                        {client.name}
                      </Link>
                    </h2>
                    {client.disabled && (
                      <Badge className="border-destructive/40 bg-destructive/5 text-destructive">
                        Disabled
                      </Badge>
                    )}
                  </div>
                  <div className="mt-auto flex items-center justify-between gap-4 border-t pt-4 text-xs text-muted-foreground">
                    <Capability
                      icon={Users}
                      available={signsIn}
                      label={
                        signsIn
                          ? `${client.authorizedUsers} ${client.authorizedUsers === 1 ? "person" : "people"} authorized`
                          : "Doesn't sign people in"
                      }
                    >
                      {signsIn && (
                        <span className="tabular-nums" aria-hidden="true">
                          {client.authorizedUsers}
                        </span>
                      )}
                    </Capability>
                    <Capability
                      icon={Lambda}
                      label={client.restricted ? "API access" : "No API access"}
                      className={
                        client.restricted
                          ? "text-emerald-600 dark:text-emerald-400"
                          : "text-muted-foreground/40"
                      }
                    >
                      <span className="font-semibold" aria-hidden="true">
                        {client.restricted ? "ON" : "OFF"}
                      </span>
                    </Capability>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
