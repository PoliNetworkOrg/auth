import {
  type ErrorComponentProps,
  createFileRoute,
  Link,
  useNavigate,
  useRouter,
} from "@tanstack/react-router";
import { useEffect, useId, useRef, useState } from "react";
import { ArrowLeft, Clock, LoaderCircle, RefreshCw, Trash2, Users } from "lucide-react";
import {
  credentialLabels,
  draftFromClient,
  normalizeClientDraft,
  type OidcClientDraft,
  type OidcClientDraftErrors,
} from "@/auth/oidc-clients";
import {
  deleteOidcClientFn,
  getOidcClient,
  getOidcClientOptions,
  rotateOidcClientSecretFn,
  updateOidcClientFn,
} from "@/auth/oidc.functions";
import { requireAccess, useAccess } from "@/components/access";
import { CopyButton } from "@/components/copy-button";
import { AppLogo } from "@/components/oidc/app-logo";
import { EndpointDetails } from "@/components/oidc/endpoint-details";
import {
  ApplicationSettingsForm,
  SettingsSection,
} from "@/components/oidc/application-settings-form";
import { SwitchRow } from "@/components/oidc/form-fields";
import { SectionNav } from "@/components/oidc/section-nav";
import { CredentialField, CredentialsReveal } from "@/components/oidc/secret-reveal";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { RouteError } from "@/components/route-error";
import { ActionError, errorFields, errorMessage } from "@/lib/action-error";
import { cn } from "cn";

export const Route = createFileRoute("/applications/$clientId")({
  head: () => ({ meta: [{ title: "Application · PoliNetwork Auth" }] }),
  beforeLoad: ({ context }) => requireAccess(context.viewer, "idp:applications:read"),
  loader: async ({ params }) => {
    const [client, options] = await Promise.all([
      getOidcClient({ data: { clientId: params.clientId } }),
      getOidcClientOptions(),
    ]);
    return { client, ...options };
  },
  // Another application starts from a clean page: no notice, revealed secret, or draft.
  remountDeps: ({ params }) => params.clientId,
  component: ApplicationDetail,
  errorComponent: ApplicationError,
});

function keyCount(jwks: string) {
  try {
    const count = (JSON.parse(jwks) as { keys?: unknown[] }).keys?.length ?? 0;
    return count === 1 ? "1 key" : `${count} keys`;
  } catch {
    return "Unreadable";
  }
}

function formatDate(value: string | null) {
  return value ? new Date(value).toLocaleDateString(undefined, { dateStyle: "medium" }) : "Unknown";
}

/** Pauses or resumes the app. Its own label says which state it's in, read and heard. */
function EnabledSwitch({
  enabled,
  disabled,
  onChange,
}: {
  enabled: boolean;
  disabled: boolean;
  onChange: (enabled: boolean) => void;
}) {
  const id = useId();
  return (
    <div className="flex items-center gap-3 sm:mt-2">
      <Label
        htmlFor={id}
        className={cn(
          "w-7 text-right text-sm font-semibold",
          enabled ? "text-foreground" : "text-muted-foreground",
          !disabled && "cursor-pointer",
        )}
      >
        {enabled ? "On" : "Off"}
      </Label>
      <Switch
        id={id}
        size="lg"
        checked={enabled}
        disabled={disabled}
        aria-label="Application enabled"
        aria-describedby={`${id}-description`}
        onCheckedChange={onChange}
      />
      <span id={`${id}-description`} className="sr-only">
        {enabled
          ? "Turning it off pauses sign-ins and token requests."
          : "Sign-ins are paused. Existing tokens expire within minutes."}
      </span>
    </div>
  );
}

function ApplicationDetail() {
  const { clientId } = Route.useParams();
  const sectionsRef = useRef<HTMLDivElement>(null);
  const { client, apiAccess } = Route.useLoaderData();
  const navigate = useNavigate();
  const router = useRouter();
  const { can, isMasterAdmin } = useAccess();
  const canWrite = can("idp:applications:write");

  const [busy, setBusy] = useState<"save" | "toggle" | "rotate" | "delete" | null>(null);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<OidcClientDraftErrors | undefined>();
  const [notice, setNotice] = useState("");
  const [formResetKey, setFormResetKey] = useState(0);
  const [rotatedSecret, setRotatedSecret] = useState<string | null>(null);
  const [rotateOpen, setRotateOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 4000);
    return () => clearTimeout(timer);
  }, [notice]);

  async function save(input: OidcClientDraft) {
    setBusy("save");
    setError("");
    setFieldErrors(undefined);
    try {
      const result = await updateOidcClientFn({
        data: { clientId, draft: normalizeClientDraft(input) },
      });
      // A newly issued secret is shown before the refresh, which could fail and lose it.
      if (result.clientSecret) setRotatedSecret(result.clientSecret);
      else if (result.client.credential !== "secret") setRotatedSecret(null);
      setNotice(
        result.clientSecret ? "Settings saved. A new client secret was issued." : "Settings saved.",
      );
      await router.invalidate({ sync: true });
      // The form now reloads the saved values from the fresh loader data.
      setFormResetKey((value) => value + 1);
    } catch (cause) {
      // Field errors come back in the form's own shape, item lists included.
      setFieldErrors(errorFields<OidcClientDraftErrors>(cause));
      setError(errorMessage(cause, "Unable to save the application."));
    } finally {
      setBusy(null);
    }
  }

  async function toggle(patch: { disabled?: boolean; skipConsent?: boolean }) {
    setBusy("toggle");
    setError("");
    try {
      const { client: updated } = await updateOidcClientFn({ data: { clientId, ...patch } });
      await router.invalidate({ sync: true });
      setNotice(
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
      const { clientSecret } = await rotateOidcClientSecretFn({ data: { clientId } });
      // The response is the only copy of the new secret. A failed loader refresh would
      // replace this page and discard it before the administrator can save it.
      setRotatedSecret(clientSecret);
      setNotice("Secret rotated. The previous secret no longer works.");
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
      await deleteOidcClientFn({ data: { clientId } });
      await navigate({ to: "/applications" });
    } catch (cause) {
      setError(errorMessage(cause, "Unable to delete the application."));
      setDeleteOpen(false);
    } finally {
      setBusy(null);
    }
  }

  const deleteReady = deleteConfirmation.trim() === client.name.trim();
  const canManage = client.restricted ? isMasterAdmin : canWrite;
  const signsIn = client.grantTypes.includes("authorization_code");

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
              <Badge className="bg-card text-muted-foreground">
                {credentialLabels[client.credential]}
              </Badge>
              {client.restricted && (
                <Badge className="bg-card text-muted-foreground">API access</Badge>
              )}
              {signsIn && (
                <Badge className="bg-card text-muted-foreground">
                  {client.applicationType === "native" ? "Native" : "Web"}
                </Badge>
              )}
            </div>
            {client.uri && (
              <a
                href={client.uri}
                target="_blank"
                rel="noreferrer"
                className="mt-2 inline-block text-sm text-primary underline-offset-4 hover:underline"
              >
                {client.uri}
              </a>
            )}
            <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <Users className="size-3.5" aria-hidden="true" />
                {client.authorizedUsers} {client.authorizedUsers === 1 ? "person" : "people"}{" "}
                authorized
              </span>
              <span className="flex items-center gap-1.5">
                <Clock className="size-3.5" aria-hidden="true" />
                Created {formatDate(client.createdAt)}
              </span>
              <span>Updated {formatDate(client.updatedAt)}</span>
            </p>
          </div>
          <EnabledSwitch
            enabled={!client.disabled}
            disabled={!canManage || busy !== null}
            onChange={(enabled) => void toggle({ disabled: !enabled })}
          />
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

      <div ref={sectionsRef} className="grid items-start gap-10 lg:grid-cols-[160px_1fr]">
        <SectionNav container={sectionsRef} />
        <div className="min-w-0 space-y-10">
          <SettingsSection id="credentials" title="Credentials">
            <div className="space-y-4 p-6">
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
              {client.credential === "private-key" && client.jwks && (
                <div className="flex items-center justify-between gap-3 rounded-lg border bg-background px-3 py-2">
                  <span className="text-sm">
                    Public JWKS
                    <span className="ml-2 text-xs text-muted-foreground">
                      {keyCount(client.jwks)}
                    </span>
                  </span>
                  <CopyButton value={client.jwks} label="Copy public JWKS" size="icon-xs" />
                </div>
              )}
              {client.credential === "secret" && !rotatedSecret && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground">Client secret</p>
                  <div className="mt-1 flex items-center justify-between gap-3 rounded-lg border bg-background px-3 py-2">
                    <code className="font-mono text-sm tracking-widest text-muted-foreground">
                      ••••••••••••••••
                    </code>
                    {canManage && (
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
                    Stored hashed, so it can't be shown again. Rotating issues a new one and revokes
                    the current one immediately.
                  </p>
                </div>
              )}
              {client.credential === "public" && (
                <p className="text-xs leading-5 text-muted-foreground">
                  Public client: no secret. The app must use PKCE.
                </p>
              )}
              {rotatedSecret && (
                <Button variant="ghost" size="sm" onClick={() => setRotatedSecret(null)}>
                  I've saved it
                </Button>
              )}
              <EndpointDetails client={client} />
            </div>
          </SettingsSection>

          <ApplicationSettingsForm
            initial={draftFromClient(client)}
            savedCredential={client.credential}
            apiAccess={apiAccess}
            canGrantApiAccess={isMasterAdmin}
            readOnly={!canManage}
            busy={busy === "save"}
            resetKey={formResetKey}
            serverErrors={fieldErrors}
            signInExtras={
              signsIn && (
                <div className="border-t pt-6">
                  <SwitchRow
                    title="Skip consent screen"
                    description="For first-party PoliNetwork apps only. People are signed in without reviewing the requested permissions. Saves right away."
                    checked={client.skipConsent}
                    disabled={!canManage || busy !== null}
                    onCheckedChange={(checked) => void toggle({ skipConsent: checked })}
                  />
                </div>
              )
            }
            onSubmit={(draft) => void save(draft)}
          />

          {canManage && (
            <SettingsSection
              id="danger-zone"
              title="Danger zone"
              className="border-destructive/60 bg-linear-to-br from-destructive/20 to-destructive/5"
            >
              <div className="flex flex-wrap items-center justify-between gap-4 p-6">
                <p className="text-sm leading-6 text-muted-foreground">
                  <span className="block">
                    Deleting removes the client, every consent, and all of its tokens.
                  </span>
                  <span className="block">
                    To pause it instead, switch it off at the top of the page.
                  </span>
                </p>
                <Button
                  variant="destructive"
                  disabled={busy !== null}
                  onClick={() => setDeleteOpen(true)}
                >
                  <Trash2 aria-hidden="true" />
                  Delete application
                </Button>
              </div>
            </SettingsSection>
          )}
        </div>
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

/** Explains a missing application in place of the generic error; anything else is generic. */
function ApplicationError({ error }: ErrorComponentProps) {
  if (!(error instanceof ActionError && error.status === 404)) return <RouteError error={error} />;
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
