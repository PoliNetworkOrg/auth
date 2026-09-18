import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppWindow, ChevronRight, Plus, Users } from "lucide-react";
import type { OidcClientSummary } from "@/auth/oidc-clients";
import { CopyButton } from "@/components/copy-button";
import { useIdpAccessContext } from "@/components/idp-access";
import { errorMessage, fetchOidcClients } from "@/components/oidc/api";
import { AppLogo } from "@/components/oidc/app-logo";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const Route = createFileRoute("/applications/")({ component: ApplicationsIndex });

function ClientBadges({ client }: { client: OidcClientSummary }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {client.disabled && (
        <Badge className="border-destructive/40 bg-destructive/5 text-destructive">Disabled</Badge>
      )}
      <Badge className="bg-card text-muted-foreground">
        {client.confidential ? "Confidential" : "Public"}
      </Badge>
      {client.applicationType === "native" && (
        <Badge className="bg-card text-muted-foreground">Native</Badge>
      )}
      {client.skipConsent && <Badge className="bg-card text-muted-foreground">Skips consent</Badge>}
    </div>
  );
}

function IntegrationCard() {
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);
  const issuer = `${origin}/api/auth`;
  const rows = [
    { label: "Issuer", value: issuer },
    { label: "Discovery", value: `${issuer}/.well-known/openid-configuration` },
    { label: "Authorization", value: `${issuer}/oauth2/authorize` },
    { label: "Token", value: `${issuer}/oauth2/token` },
    { label: "UserInfo", value: `${issuer}/oauth2/userinfo` },
    { label: "JWKS", value: `${issuer}/jwks` },
  ];
  return (
    <Card>
      <CardHeader>
        <CardTitle>Connecting an application</CardTitle>
        <CardDescription>
          Use authorization code with PKCE, validate the issuer, audience, signature, and
          expiration, and request <code className="font-mono text-xs">polinetwork:identity</code>{" "}
          only when the app needs membership data.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <dl className="divide-y">
          {rows.map((row) => (
            <div key={row.label} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
              <dt className="w-28 shrink-0 text-xs font-medium text-muted-foreground">
                {row.label}
              </dt>
              <dd className="min-w-0 flex-1 truncate font-mono text-xs" title={row.value}>
                {origin ? row.value : "…"}
              </dd>
              {origin && (
                <CopyButton value={row.value} label={`Copy ${row.label} URL`} size="icon-xs" />
              )}
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}

function ApplicationsIndex() {
  const { can } = useIdpAccessContext();
  const canRead = can("idp:applications:read");
  const canWrite = can("idp:applications:write");
  const [clients, setClients] = useState<OidcClientSummary[] | null>(null);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    // Someone who may only register applications would be refused this list.
    if (!canRead) return;
    const controller = new AbortController();
    setError("");
    fetchOidcClients(undefined, controller.signal)
      .then(setClients)
      .catch((cause: unknown) => {
        if (!controller.signal.aborted)
          setError(errorMessage(cause, "Unable to load applications."));
      });
    return () => controller.abort();
  }, [revision, canRead]);

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">Applications</h1>
          <p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground">
            Services that sign people in with PoliNetwork Identity through OpenID Connect.
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
      </div>

      {error && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-destructive bg-destructive/5 p-4 text-sm"
        >
          <span>{error}</span>
          <Button variant="outline" size="sm" onClick={() => setRevision((value) => value + 1)}>
            Try again
          </Button>
        </div>
      )}

      <div className="grid items-start gap-8 lg:grid-cols-[1fr_340px]">
        <div>
          {!canRead ? (
            <Card>
              <CardContent className="flex flex-col items-center gap-4 px-6 py-14 text-center">
                <div className="flex size-14 items-center justify-center rounded-2xl border bg-background text-primary">
                  <AppWindow className="size-6" aria-hidden="true" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold">Register an application</h2>
                  <p className="mt-2 max-w-sm text-sm leading-6 text-muted-foreground">
                    Your access covers registering applications. Ask an administrator for view
                    access to see the ones already registered.
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
          ) : clients === null && !error ? (
            <ul aria-busy="true" aria-label="Loading applications" className="space-y-3">
              {[0, 1, 2].map((index) => (
                <li key={index} className="h-20 animate-pulse rounded-2xl border bg-card" />
              ))}
            </ul>
          ) : clients && clients.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center gap-4 px-6 py-14 text-center">
                <div className="flex size-14 items-center justify-center rounded-2xl border bg-background text-primary">
                  <AppWindow className="size-6" aria-hidden="true" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold">No applications yet</h2>
                  <p className="mt-2 max-w-sm text-sm leading-6 text-muted-foreground">
                    Register the first service that should offer “Sign in with PoliNetwork”. You'll
                    get a client ID and, for confidential apps, a secret.
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
          ) : clients ? (
            <Card>
              <ul className="divide-y" aria-label="Applications">
                {clients.map((client) => (
                  <li key={client.clientId}>
                    <Link
                      to="/applications/$clientId"
                      params={{ clientId: client.clientId }}
                      className="flex items-center gap-4 px-5 py-4 transition-colors outline-none first:rounded-t-2xl last:rounded-b-2xl hover:bg-accent/50 focus-visible:bg-accent/50"
                    >
                      <AppLogo
                        name={client.name}
                        logo={client.logo}
                        className={client.disabled ? "opacity-50 grayscale" : undefined}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                          <h2 className="truncate text-sm font-semibold">{client.name}</h2>
                          <ClientBadges client={client} />
                        </div>
                        <p className="mt-1 truncate font-mono text-xs text-muted-foreground">
                          {client.clientId}
                        </p>
                      </div>
                      <div className="hidden items-center gap-1.5 text-xs text-muted-foreground sm:flex">
                        <Users className="size-3.5" aria-hidden="true" />
                        <span>
                          {client.authorizedUsers}{" "}
                          {client.authorizedUsers === 1 ? "person" : "people"}
                        </span>
                      </div>
                      <ChevronRight
                        className="size-4 shrink-0 text-muted-foreground"
                        aria-hidden="true"
                      />
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
        </div>
        <IntegrationCard />
      </div>
    </div>
  );
}
