import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  ArrowLeft,
  Clock,
  KeyRound,
  LoaderCircle,
  RefreshCw,
  Trash2,
  TriangleAlert,
  Users,
} from "lucide-react";
import { authClient } from "@/auth/client";
import {
  draftFromClient,
  normalizeClientDraft,
  type OidcClientDraft,
  type OidcClientDraftErrors,
  type OidcClientSummary,
} from "@/auth/oidc-clients";
import { CopyButton } from "@/components/copy-button";
import { useIdpAccessContext } from "@/components/idp-access";
import { ApiError, errorMessage, fetchOidcClients, saveOidcClient } from "@/components/oidc/api";
import { AppLogo } from "@/components/oidc/app-logo";
import { ClientForm } from "@/components/oidc/client-form";
import { CredentialField, CredentialsReveal } from "@/components/oidc/secret-reveal";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

export const Route = createFileRoute("/applications/$clientId")({
  head: () => ({ meta: [{ title: "Application · PoliNetwork Auth" }] }),
  component: ApplicationDetail,
});

function formatDate(value: string | null) {
  return value ? new Date(value).toLocaleDateString(undefined, { dateStyle: "medium" }) : "Unknown";
}

function ToggleRow({
  id,
  title,
  description,
  checked,
  disabled,
  onCheckedChange,
}: {
  id: string;
  title: string;
  description: string;
  checked: boolean;
  disabled: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-4 first:pt-0 last:pb-0">
      <div className="min-w-0">
        <Label htmlFor={id} className="cursor-pointer">
          {title}
        </Label>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p>
      </div>
      <Switch id={id} checked={checked} disabled={disabled} onCheckedChange={onCheckedChange} />
    </div>
  );
}

function ApplicationDetail() {
  const { clientId } = Route.useParams();
  const navigate = useNavigate();
  const { can } = useIdpAccessContext();
  const canWrite = can("idp:applications:write");
  const [client, setClient] = useState<OidcClientSummary | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [revision, setRevision] = useState(0);

  const [busy, setBusy] = useState<"save" | "toggle" | "rotate" | "delete" | null>(null);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<OidcClientDraftErrors | undefined>();
  const [notice, setNotice] = useState("");
  const [formKey, setFormKey] = useState(0);
  const [rotatedSecret, setRotatedSecret] = useState<string | null>(null);
  const [rotateOpen, setRotateOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    setLoadError("");
    fetchOidcClients(clientId, controller.signal)
      .then((clients) => {
        const found = clients[0];
        if (found) setClient(found);
        else setNotFound(true);
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted)
          setLoadError(errorMessage(cause, "Unable to load this application."));
      });
    return () => controller.abort();
  }, [clientId, revision]);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 4000);
    return () => clearTimeout(timer);
  }, [notice]);

  function apply(updated: OidcClientSummary, message: string) {
    setClient(updated);
    setNotice(message);
  }

  async function save(input: OidcClientDraft) {
    setBusy("save");
    setError("");
    setFieldErrors(undefined);
    try {
      const updated = await saveOidcClient({ clientId, draft: normalizeClientDraft(input) });
      apply(updated, "Settings saved.");
      setFormKey((value) => value + 1);
    } catch (cause) {
      if (cause instanceof ApiError && cause.fields) setFieldErrors(cause.fields);
      setError(errorMessage(cause, "Unable to save the application."));
    } finally {
      setBusy(null);
    }
  }

  async function toggle(patch: { disabled?: boolean; skipConsent?: boolean }) {
    setBusy("toggle");
    setError("");
    try {
      const updated = await saveOidcClient({ clientId, ...patch });
      apply(
        updated,
        patch.disabled !== undefined
          ? updated.disabled
            ? "Sign-ins through this application are paused."
            : "Application enabled."
          : updated.skipConsent
            ? "Consent screen skipped for this application."
            : "Consent screen restored.",
      );
    } catch (cause) {
      setError(errorMessage(cause, "Unable to update the application."));
    } finally {
      setBusy(null);
    }
  }

  async function rotate() {
    setBusy("rotate");
    setError("");
    try {
      const result = await authClient.oauth2.client.rotateSecret({ client_id: clientId });
      if (result.error) setError(result.error.message ?? "Unable to rotate the secret.");
      else {
        setRotatedSecret(result.data.client_secret ?? null);
        setNotice("Secret rotated. The previous secret no longer works.");
      }
    } catch (cause) {
      setError(errorMessage(cause, "Unable to rotate the secret."));
    } finally {
      setBusy(null);
      setRotateOpen(false);
    }
  }

  async function remove() {
    setBusy("delete");
    setError("");
    try {
      const result = await authClient.oauth2.deleteClient({ client_id: clientId });
      if (result.error) {
        setError(result.error.message ?? "Unable to delete the application.");
        setDeleteOpen(false);
        return;
      }
      await navigate({ to: "/applications" });
    } catch (cause) {
      setError(errorMessage(cause, "Unable to delete the application."));
      setDeleteOpen(false);
    } finally {
      setBusy(null);
    }
  }

  if (notFound) {
    return (
      <div className="mx-auto max-w-lg py-10 text-center">
        <h1 className="text-2xl font-bold tracking-tight">Application not found</h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          It may have been deleted, or the link is out of date.
        </p>
        <Button className="mt-6" asChild>
          <Link to="/applications">
            <ArrowLeft aria-hidden="true" />
            All applications
          </Link>
        </Button>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="mx-auto max-w-lg space-y-4 py-10 text-center">
        <p role="alert">{loadError}</p>
        <Button onClick={() => setRevision((value) => value + 1)}>Try again</Button>
      </div>
    );
  }

  if (!client) {
    return (
      <div aria-busy="true" className="space-y-6">
        <div className="h-8 w-40 animate-pulse rounded-md bg-card" />
        <div className="h-24 animate-pulse rounded-2xl border bg-card" />
        <div className="h-96 animate-pulse rounded-2xl border bg-card" />
      </div>
    );
  }

  const deleteReady = deleteConfirmation.trim() === client.name.trim();

  return (
    <div className="space-y-8">
      <div>
        <Button variant="ghost" size="sm" className="-ml-2 text-muted-foreground" asChild>
          <Link to="/applications">
            <ArrowLeft aria-hidden="true" />
            Applications
          </Link>
        </Button>
        <div className="mt-4 flex flex-wrap items-start gap-5">
          <AppLogo
            name={client.name}
            logo={client.logo}
            className={`size-16 text-lg ${client.disabled ? "opacity-50 grayscale" : ""}`}
          />
          <div className="min-w-0 flex-1 basis-64">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-3xl font-extrabold tracking-tight break-words sm:text-4xl">
                {client.name}
              </h1>
              {client.disabled && (
                <Badge className="border-destructive/40 bg-destructive/5 text-destructive">
                  Disabled
                </Badge>
              )}
              <Badge className="bg-card text-muted-foreground">
                {client.confidential ? "Confidential" : "Public"}
              </Badge>
              <Badge className="bg-card text-muted-foreground">
                {client.applicationType === "native" ? "Native" : "Web"}
              </Badge>
            </div>
            <div className="mt-2 flex items-center gap-1 text-sm text-muted-foreground">
              <code className="truncate font-mono text-xs">{client.clientId}</code>
              <CopyButton value={client.clientId} label="Copy client ID" size="icon-xs" />
            </div>
            {client.uri && (
              <a
                href={client.uri}
                target="_blank"
                rel="noreferrer"
                className="mt-1 inline-block text-sm text-primary underline-offset-4 hover:underline"
              >
                {client.uri}
              </a>
            )}
          </div>
        </div>
      </div>

      <div aria-live="polite" className="space-y-3">
        {notice && (
          <p role="status" className="rounded-xl border border-primary/40 bg-primary/5 p-4 text-sm">
            {notice}
          </p>
        )}
        {error && (
          <p
            role="alert"
            className="rounded-xl border border-destructive bg-destructive/5 p-4 text-sm"
          >
            {error}
          </p>
        )}
      </div>

      <div className="grid items-start gap-8 lg:grid-cols-[1fr_340px]">
        <div className="space-y-8">
          <Card>
            <CardHeader>
              <CardTitle>Settings</CardTitle>
              <CardDescription>
                Changes apply to the next sign-in. Redirect URIs must match your app exactly.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <fieldset disabled={!canWrite} className="border-0 p-0">
                <ClientForm
                  key={formKey}
                  mode="edit"
                  initial={draftFromClient(client)}
                  confidential={client.confidential}
                  readOnly={!canWrite}
                  busy={busy === "save"}
                  serverErrors={fieldErrors}
                  submitLabel="Save changes"
                  onSubmit={(draft) => void save(draft)}
                />
              </fieldset>
            </CardContent>
          </Card>

          {canWrite && (
            <Card className="border-destructive/40">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-destructive">
                  <TriangleAlert className="size-4" aria-hidden="true" />
                  Danger zone
                </CardTitle>
                <CardDescription>
                  Deleting removes the client, every consent, and all of its tokens. People who used
                  it will have to be set up again in a new application.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-wrap items-center justify-between gap-4">
                <p className="text-sm">
                  Prefer a pause? Disable the application instead; it can be re-enabled anytime.
                </p>
                <Button
                  variant="destructive"
                  disabled={busy !== null}
                  onClick={() => setDeleteOpen(true)}
                >
                  <Trash2 aria-hidden="true" />
                  Delete application
                </Button>
              </CardContent>
            </Card>
          )}
        </div>

        <aside className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <KeyRound className="size-4 text-primary" aria-hidden="true" />
                Credentials
              </CardTitle>
              <CardDescription>
                {client.confidential
                  ? "The client authenticates to the token endpoint with its ID and secret."
                  : "Public client: no secret. The app must use PKCE."}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {rotatedSecret ? (
                <CredentialsReveal
                  clientId={client.clientId}
                  clientSecret={rotatedSecret}
                  title="New client secret"
                  description="Update your app's configuration now. The old secret is already invalid."
                />
              ) : (
                <CredentialField label="Client ID" value={client.clientId} />
              )}
              {client.confidential && !rotatedSecret && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground">Client secret</p>
                  <div className="mt-1 flex items-center justify-between gap-3 rounded-lg border bg-background px-3 py-2">
                    <code className="font-mono text-sm tracking-widest text-muted-foreground">
                      ••••••••••••••••
                    </code>
                    {canWrite && (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={busy !== null}
                        onClick={() => setRotateOpen(true)}
                      >
                        <RefreshCw aria-hidden="true" />
                        Rotate
                      </Button>
                    )}
                  </div>
                  <p className="mt-2 text-xs leading-5 text-muted-foreground">
                    Secrets are stored hashed and cannot be shown again. Rotating issues a new one
                    and immediately revokes the current one.
                  </p>
                </div>
              )}
              {rotatedSecret && (
                <Button variant="ghost" size="sm" onClick={() => setRotatedSecret(null)}>
                  I've saved it
                </Button>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Access</CardTitle>
              <CardDescription>
                Control whether and how people sign in through this app.
              </CardDescription>
            </CardHeader>
            <CardContent className="divide-y">
              <ToggleRow
                id="client-enabled"
                title="Enabled"
                description={
                  client.disabled
                    ? "Sign-ins are paused. Existing tokens expire within minutes."
                    : "People can sign in through this application."
                }
                checked={!client.disabled}
                disabled={!canWrite || busy !== null}
                onCheckedChange={(checked) => void toggle({ disabled: !checked })}
              />
              <ToggleRow
                id="client-skip-consent"
                title="Skip consent screen"
                description="For first-party PoliNetwork apps only. People are signed in without reviewing the requested permissions."
                checked={client.skipConsent}
                disabled={!canWrite || busy !== null}
                onCheckedChange={(checked) => void toggle({ skipConsent: checked })}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Usage</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="space-y-3 text-sm">
                <div className="flex items-center gap-3">
                  <Users className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <dt className="text-muted-foreground">Authorized</dt>
                  <dd className="ml-auto font-medium">
                    {client.authorizedUsers} {client.authorizedUsers === 1 ? "person" : "people"}
                  </dd>
                </div>
                <div className="flex items-center gap-3">
                  <Clock className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <dt className="text-muted-foreground">Created</dt>
                  <dd className="ml-auto font-medium">{formatDate(client.createdAt)}</dd>
                </div>
                <div className="flex items-center gap-3">
                  <RefreshCw className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <dt className="text-muted-foreground">Updated</dt>
                  <dd className="ml-auto font-medium">{formatDate(client.updatedAt)}</dd>
                </div>
              </dl>
            </CardContent>
          </Card>
        </aside>
      </div>

      <Dialog open={rotateOpen} onOpenChange={(open) => busy === null && setRotateOpen(open)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rotate the client secret?</DialogTitle>
            <DialogDescription>
              The current secret stops working immediately. Your app will fail to exchange codes
              until it uses the new one, so have a deploy ready.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" disabled={busy !== null} onClick={() => setRotateOpen(false)}>
              Cancel
            </Button>
            <Button disabled={busy !== null} onClick={() => void rotate()}>
              {busy === "rotate" ? (
                <LoaderCircle className="animate-spin" aria-hidden="true" />
              ) : (
                <RefreshCw aria-hidden="true" />
              )}
              Rotate secret
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={deleteOpen}
        onOpenChange={(open) => {
          if (busy !== null) return;
          setDeleteOpen(open);
          if (!open) setDeleteConfirmation("");
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {client.name}?</DialogTitle>
            <DialogDescription>
              This permanently removes the application, its consents, and all tokens. Type the
              application name to confirm.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="delete-confirmation">Application name</Label>
            <Input
              id="delete-confirmation"
              autoComplete="off"
              placeholder={client.name}
              value={deleteConfirmation}
              onChange={(event) => setDeleteConfirmation(event.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" disabled={busy !== null} onClick={() => setDeleteOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={!deleteReady || busy !== null}
              onClick={() => void remove()}
            >
              {busy === "delete" ? (
                <LoaderCircle className="animate-spin" aria-hidden="true" />
              ) : (
                <Trash2 aria-hidden="true" />
              )}
              Delete permanently
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
