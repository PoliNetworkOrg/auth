import { createFileRoute, useLocation } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  BadgeCheck,
  Clock,
  KeyRound,
  LoaderCircle,
  RefreshCw,
  Shield,
  ShieldOff,
  TriangleAlert,
  UserRound,
} from "lucide-react";
import { z } from "zod";
import { authClient } from "@/auth/client";
import { describeScope } from "@/auth/oidc-clients";
import { AppHandshake, LoginLayout } from "@/components/login-page";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { UserAvatar } from "@/components/user-avatar";

export const Route = createFileRoute("/consent")({
  head: () => ({ meta: [{ title: "Authorize application · PoliNetwork Auth" }] }),
  component: Consent,
});

type ConsentRequest = {
  clientId: string;
  scopes: string[];
  claims: string[];
  redirectHost: string | null;
  expiresAt: number | null;
  signed: boolean;
};

const claimsRequestSchema = z.object({
  userinfo: z.record(z.string(), z.unknown()).optional(),
  id_token: z.record(z.string(), z.unknown()).optional(),
});

function parseConsentRequest(search: string): ConsentRequest {
  const params = new URLSearchParams(search);
  const claims = new Set<string>();
  const rawClaims = params.get("claims");
  if (rawClaims) {
    try {
      const parsed = claimsRequestSchema.safeParse(JSON.parse(rawClaims));
      if (parsed.success) {
        for (const key of Object.keys(parsed.data.userinfo ?? {})) claims.add(key);
        for (const key of Object.keys(parsed.data.id_token ?? {})) claims.add(key);
      }
    } catch {
      /* Malformed claims are ignored; the server validates them. */
    }
  }
  let redirectHost: string | null = null;
  try {
    redirectHost = new URL(params.get("redirect_uri") ?? "").host || null;
  } catch {
    redirectHost = null;
  }
  const exp = Number(params.get("exp"));
  return {
    clientId: params.get("client_id") ?? "",
    scopes: (params.get("scope") ?? "").split(" ").filter(Boolean),
    claims: [...claims],
    redirectHost,
    expiresAt: Number.isFinite(exp) && exp > 0 ? exp * 1000 : null,
    signed: params.has("sig"),
  };
}

type RequestingApp = {
  name: string;
  logo: string | null;
  uri: string | null;
  policyUri: string | null;
  tosUri: string | null;
};

const scopeIcons: Record<string, typeof Shield> = {
  openid: KeyRound,
  profile: UserRound,
  "polinetwork:identity": BadgeCheck,
  offline_access: RefreshCw,
};

function Notice({
  icon: Icon,
  title,
  children,
  action,
}: {
  icon: typeof Shield;
  title: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-4 px-6 py-10 text-center">
        <div className="flex size-12 items-center justify-center rounded-2xl border bg-background text-muted-foreground">
          <Icon className="size-5" aria-hidden="true" />
        </div>
        <div>
          <h1 className="text-xl font-bold tracking-tight">{title}</h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">{children}</p>
        </div>
        {action}
      </CardContent>
    </Card>
  );
}

function Consent() {
  const { data: session, isPending } = authClient.useSession();
  // Parse the signed request from the router so the server renders the same state.
  const { searchStr } = useLocation();
  const request = useMemo(() => parseConsentRequest(searchStr), [searchStr]);
  const [app, setApp] = useState<RequestingApp | null>(null);
  const [appStatus, setAppStatus] = useState<"loading" | "ready" | "unavailable" | "error">(
    "loading",
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<"allow" | "deny" | "switch" | null>(null);

  // Consent needs a session: hand signed-out visitors to the login page with the same request.
  // The raw browser query is forwarded untouched so its signature keeps verifying.
  useEffect(() => {
    if (!isPending && !session && request.signed && request.clientId)
      window.location.replace(`/${window.location.search}`);
  }, [isPending, session, request]);

  useEffect(() => {
    if (!session || !request.clientId) return;
    let active = true;
    setAppStatus("loading");
    void authClient.oauth2
      .publicClient({ query: { client_id: request.clientId } })
      .then((result) => {
        if (!active) return;
        if (result.error) {
          setAppStatus(result.error.status === 404 ? "unavailable" : "error");
          return;
        }
        setApp({
          name: result.data.client_name ?? "This application",
          logo: result.data.logo_uri ?? null,
          uri: result.data.client_uri ?? null,
          policyUri: result.data.policy_uri ?? null,
          tosUri: result.data.tos_uri ?? null,
        });
        setAppStatus("ready");
      })
      .catch(() => {
        if (active) setAppStatus("error");
      });
    return () => {
      active = false;
    };
  }, [session, request]);

  async function decide(accept: boolean) {
    setBusy(accept ? "allow" : "deny");
    setError("");
    try {
      const result = await authClient.oauth2.consent({ accept });
      if (result.error) setError(result.error.message ?? "Unable to process your choice.");
      else if (result.data?.url) window.location.assign(result.data.url);
    } catch {
      setError("Unable to reach PoliNetwork. Please try again.");
    } finally {
      setBusy(null);
    }
  }

  async function switchAccount() {
    setBusy("switch");
    try {
      await authClient.signOut();
    } finally {
      window.location.assign(`/${window.location.search}`);
    }
  }

  if (isPending || (!session && request.signed && request.clientId)) {
    return (
      <LoginLayout wide>
        <p role="status" className="text-center text-sm text-muted-foreground">
          Preparing your sign-in…
        </p>
      </LoginLayout>
    );
  }

  if (!request.clientId || !request.signed) {
    return (
      <LoginLayout wide>
        <Notice icon={TriangleAlert} title="This request is incomplete">
          Start the sign-in again from the application you were using.
        </Notice>
      </LoginLayout>
    );
  }

  if (request.expiresAt !== null && request.expiresAt < Date.now()) {
    return (
      <LoginLayout wide>
        <Notice
          icon={Clock}
          title="This request has expired"
          action={
            app?.uri ? (
              <Button asChild>
                <a href={app.uri}>Back to {app.name}</a>
              </Button>
            ) : undefined
          }
        >
          For your security, sign-in requests are only valid for a few minutes. Go back to the
          application and try again.
        </Notice>
      </LoginLayout>
    );
  }

  if (appStatus === "unavailable") {
    return (
      <LoginLayout wide>
        <Notice icon={ShieldOff} title="This application isn't available">
          It has been disabled or is no longer registered with PoliNetwork. Nothing was shared.
        </Notice>
      </LoginLayout>
    );
  }

  const appName = app?.name ?? "This application";
  const scopes = request.scopes.map(describeScope);

  return (
    <LoginLayout wide>
      <Card>
        <CardContent className="space-y-6 px-6 pt-8 pb-8 sm:px-8">
          <AppHandshake app={app} />
          <div className="text-center">
            <h1 className="text-2xl font-bold tracking-tight text-balance">
              <span className="text-primary">{appName}</span> wants to access your PoliNetwork
              account
            </h1>
            {app?.uri && (
              <a
                href={app.uri}
                target="_blank"
                rel="noreferrer"
                className="mt-2 inline-block text-sm text-muted-foreground underline-offset-4 hover:underline"
              >
                {new URL(app.uri).host}
              </a>
            )}
            {appStatus === "error" && (
              <p className="mt-2 text-xs text-muted-foreground">
                We couldn't load this application's details. You can still decide below.
              </p>
            )}
          </div>

          {session && (
            <div className="flex items-center gap-3 rounded-xl border bg-muted/40 p-3">
              <div className="size-9 shrink-0 overflow-hidden rounded-full border bg-background text-xs font-semibold text-muted-foreground">
                <UserAvatar name={session.user.name} image={session.user.image} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{session.user.name}</p>
                <p className="text-xs text-muted-foreground">Signed in to PoliNetwork</p>
              </div>
              <Button
                type="button"
                variant="link"
                size="sm"
                className="shrink-0"
                disabled={busy !== null}
                onClick={() => void switchAccount()}
              >
                {busy === "switch" ? (
                  <LoaderCircle className="animate-spin" aria-hidden="true" />
                ) : null}
                Not you?
              </Button>
            </div>
          )}

          <section aria-labelledby="consent-scopes">
            <h2 id="consent-scopes" className="text-sm font-semibold">
              {appName} will be able to:
            </h2>
            {scopes.length ? (
              <ul className="mt-3 divide-y rounded-xl border">
                {scopes.map((scope) => {
                  const Icon = scopeIcons[scope.id] ?? Shield;
                  return (
                    <li key={scope.id} className="flex items-start gap-3 p-3.5">
                      <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                        <Icon className="size-4" aria-hidden="true" />
                      </span>
                      <div className="min-w-0">
                        <p className="text-sm font-medium">{scope.label}</p>
                        <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
                          {scope.description}
                        </p>
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="mt-3 text-sm text-muted-foreground">Confirm that it's you.</p>
            )}
            {request.claims.length > 0 && (
              <p className="mt-3 text-xs leading-5 text-muted-foreground">
                It also asks for these profile details:{" "}
                <span className="font-medium text-foreground">{request.claims.join(", ")}</span>.
              </p>
            )}
          </section>

          {error && (
            <p
              role="alert"
              className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm leading-6"
            >
              {error}
            </p>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <Button
              type="button"
              variant="outline"
              className="h-11 bg-card"
              disabled={busy !== null || appStatus === "loading"}
              onClick={() => void decide(false)}
            >
              {busy === "deny" && <LoaderCircle className="animate-spin" aria-hidden="true" />}
              Deny
            </Button>
            <Button
              type="button"
              className="h-11"
              disabled={busy !== null || appStatus === "loading"}
              onClick={() => void decide(true)}
            >
              {busy === "allow" && <LoaderCircle className="animate-spin" aria-hidden="true" />}
              Allow
            </Button>
          </div>

          <p className="text-center text-xs leading-5 text-muted-foreground">
            {request.redirectHost && (
              <>
                You'll be sent back to{" "}
                <span className="font-medium text-foreground">{request.redirectHost}</span>.{" "}
              </>
            )}
            PoliNetwork shares only what's listed above.
            {(app?.policyUri || app?.tosUri) && (
              <>
                {" "}
                {app.policyUri && (
                  <a
                    href={app.policyUri}
                    target="_blank"
                    rel="noreferrer"
                    className="underline underline-offset-4"
                  >
                    Privacy policy
                  </a>
                )}
                {app.policyUri && app.tosUri && " · "}
                {app.tosUri && (
                  <a
                    href={app.tosUri}
                    target="_blank"
                    rel="noreferrer"
                    className="underline underline-offset-4"
                  >
                    Terms
                  </a>
                )}
              </>
            )}
          </p>
        </CardContent>
      </Card>
    </LoginLayout>
  );
}
