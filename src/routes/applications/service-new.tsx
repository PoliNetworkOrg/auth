import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { ArrowLeft, CircleCheck } from "lucide-react";
import { SERVICE_CLIENT_TEMPLATES, type ServiceClientKind } from "@/auth/service-client-templates";
import { useIdpAccessContext } from "@/components/idp-access";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export const Route = createFileRoute("/applications/service-new")({
  head: () => ({ meta: [{ title: "Service client · PoliNetwork Auth" }] }),
  component: ServiceClientRegistration,
});

function publicJwks(input: string): { keys: Record<string, unknown>[] } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(input);
  } catch {
    throw new Error("Paste a valid public JWKS JSON object.");
  }
  if (!parsed || typeof parsed !== "object" || !("keys" in parsed))
    throw new Error("The JWKS needs a keys array.");
  const keys = (parsed as { keys: unknown }).keys;
  if (!Array.isArray(keys) || keys.length === 0 || keys.length > 5)
    throw new Error("The JWKS needs between one and five public keys.");
  for (const key of keys) {
    if (!key || typeof key !== "object") throw new Error("Each key must be an object.");
    if (["d", "p", "q", "dp", "dq", "qi", "oth", "k"].some((field) => field in key))
      throw new Error("Paste public keys only. Keep private keys in the service's Key Vault.");
  }
  return { keys: keys as Record<string, unknown>[] };
}

function ServiceClientRegistration() {
  const { isMasterAdmin, status } = useIdpAccessContext();
  const [kind, setKind] = useState<ServiceClientKind>("telegram-bot");
  const [jwksText, setJwksText] = useState("");
  const [redirectUri, setRedirectUri] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [created, setCreated] = useState<{ clientId: string; linked: boolean } | null>(null);
  const template = SERVICE_CLIENT_TEMPLATES[kind];

  async function register() {
    setError("");
    setBusy(true);
    try {
      const jwks = publicJwks(jwksText);
      if (template.interactive && !redirectUri.trim())
        throw new Error("Enter the dashboard's exact redirect URI.");
      const response = await fetch("/api/oidc/service-client", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, jwks, redirectUri: redirectUri.trim() || undefined }),
      });
      const result: { clientId?: string; linked?: boolean; error?: string } = await response.json();
      if (!response.ok || !result.clientId)
        throw new Error(result.error ?? "Unable to register the service client.");
      setCreated({ clientId: result.clientId, linked: result.linked === true });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to register the service client.");
    } finally {
      setBusy(false);
    }
  }

  async function retryLink() {
    if (!created) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/oidc/resource-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId: created.clientId, resource: template.resource }),
      });
      if (!response.ok)
        throw new Error("Resource link failed. Try again after checking OAuth configuration.");
      setCreated({ ...created, linked: true });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Resource link failed.");
    } finally {
      setBusy(false);
    }
  }

  if (status !== "ready")
    return <p className="py-10 text-sm text-muted-foreground">Checking access…</p>;
  if (!isMasterAdmin)
    return <p className="py-10 text-sm text-muted-foreground">Master Admin access is required.</p>;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Button variant="ghost" size="sm" asChild>
        <Link to="/applications">
          <ArrowLeft aria-hidden="true" /> Applications
        </Link>
      </Button>
      <div>
        <h1 className="text-3xl font-extrabold tracking-tight">Register a service client</h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          Each service needs its own key pair. Paste only its public JWKS here; store the private
          key with that service.
        </p>
      </div>
      {error && (
        <p role="alert" className="rounded-xl border border-destructive p-4 text-sm">
          {error}
        </p>
      )}
      {created ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              {created.linked && <CircleCheck aria-hidden="true" />} Client registered
            </CardTitle>
            <CardDescription>
              {created.linked
                ? "Record this client ID in deployment configuration and mount its private key only to the owning service."
                : "The client exists, but its resource link is pending. Retry before using it."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <code className="block rounded-md border p-3 text-sm break-all">
              {created.clientId}
            </code>
            {!created.linked && (
              <Button disabled={busy} onClick={() => void retryLink()}>
                Retry resource link
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="space-y-5 pt-6">
            <div className="space-y-2">
              <Label htmlFor="service-kind">Service</Label>
              <select
                id="service-kind"
                className="flex h-10 w-full rounded-md border bg-background px-3 text-sm"
                value={kind}
                onChange={(event) => setKind(event.target.value as ServiceClientKind)}
              >
                {Object.entries(SERVICE_CLIENT_TEMPLATES).map(([key, value]) => (
                  <option key={key} value={key}>
                    {value.name}
                  </option>
                ))}
              </select>
            </div>
            <p className="text-xs text-muted-foreground">
              Allowed scopes: <code>{template.scopes.join(" ")}</code>
            </p>
            {template.interactive && (
              <div className="space-y-2">
                <Label htmlFor="redirect-uri">Dashboard redirect URI</Label>
                <Input
                  id="redirect-uri"
                  value={redirectUri}
                  onChange={(event) => setRedirectUri(event.target.value)}
                  placeholder="https://dashboard.example/callback"
                />
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="service-jwks">Public JWKS</Label>
              <Textarea
                id="service-jwks"
                rows={9}
                className="font-mono text-xs"
                value={jwksText}
                onChange={(event) => setJwksText(event.target.value)}
                placeholder={'{"keys":[{"kty":"OKP","crv":"Ed25519","x":"...","kid":"..."}]}'}
              />
            </div>
            <Button disabled={busy} onClick={() => void register()}>
              {busy ? "Registering…" : "Register service client"}
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
