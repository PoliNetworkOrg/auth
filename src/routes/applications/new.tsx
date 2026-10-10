import { createFileRoute, Link, useNavigate, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { ArrowLeft, ArrowRight, CircleCheck, TriangleAlert } from "lucide-react";
import { CLIENT_PRESETS } from "@/auth/client-presets";
import {
  emptyClientDraft,
  normalizeClientDraft,
  type OidcClientDraft,
  type OidcClientDraftErrors,
} from "@/auth/oidc-clients";
import { createOidcClientFn, getOidcClientOptions } from "@/auth/oidc.functions";
import { NewApplicationWizard } from "@/components/oidc/new-application-wizard";
import { CredentialsReveal } from "@/components/oidc/secret-reveal";
import { requireAccess, useAccess } from "@/components/access";
import { Button } from "@/components/ui/button";
import { errorFields, errorMessage } from "@/lib/action-error";

export const Route = createFileRoute("/applications/new")({
  head: () => ({ meta: [{ title: "New application · PoliNetwork Auth" }] }),
  beforeLoad: ({ context }) => requireAccess(context.viewer, "idp:applications:write"),
  loader: () => getOidcClientOptions(),
  component: NewApplication,
});

type Created = {
  clientId: string;
  clientSecret: string | null;
  name: string;
  privateKey: boolean;
  linked: boolean;
};

function NewApplication() {
  const navigate = useNavigate();
  const router = useRouter();
  const { apiAccess } = Route.useLoaderData();
  const { isMasterAdmin } = useAccess();
  const [initial, setInitial] = useState(emptyClientDraft);
  const [presetId, setPresetId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<OidcClientDraftErrors | undefined>();
  const [created, setCreated] = useState<Created | null>(null);

  function applyPreset(id: string | null) {
    const preset = CLIENT_PRESETS.find((candidate) => candidate.id === id);
    setPresetId(preset ? preset.id : null);
    // A new object restarts the wizard from the first step with the preset filled in.
    setInitial({ ...emptyClientDraft(), ...preset?.draft });
    setFieldErrors(undefined);
  }

  async function create(input: OidcClientDraft) {
    const draft = normalizeClientDraft(input);
    setBusy(true);
    setError("");
    setFieldErrors(undefined);
    try {
      const result = await createOidcClientFn({ data: { draft } });
      // Drops any cached copy of the list, which doesn't have the new application yet.
      await router.invalidate({ sync: true });
      setCreated({
        ...result,
        name: draft.name,
        privateKey: draft.credential === "private-key",
      });
      window.scrollTo({ top: 0 });
    } catch (cause) {
      setFieldErrors(errorFields<OidcClientDraftErrors>(cause));
      setError(errorMessage(cause, "Unable to create the application."));
    } finally {
      setBusy(false);
    }
  }

  if (created) {
    return (
      <div className="mx-auto max-w-2xl space-y-8">
        <div className="text-center">
          <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <CircleCheck className="size-7" aria-hidden="true" />
          </div>
          <h1 className="mt-5 text-3xl font-extrabold tracking-tight">{created.name} is ready</h1>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            Configure your app with these credentials. You can change everything else later.
          </p>
        </div>
        {!created.linked && (
          <p
            role="alert"
            className="flex items-start gap-2 rounded-xl border border-destructive bg-destructive/5 p-4 text-sm"
          >
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden="true" />
            The application exists, but its API resources are not linked yet. Open it, check API
            access, and save to retry before using it.
          </p>
        )}
        <CredentialsReveal
          clientId={created.clientId}
          clientSecret={created.clientSecret}
          title={created.clientSecret ? "Save your client secret now" : "Your client ID"}
          description={
            created.clientSecret
              ? "Your app authenticates to the token endpoint with this client ID and secret."
              : created.privateKey
                ? "Your app signs its token requests with the private key that matches the registered JWKS. Keep that key with the service."
                : "Public clients authenticate with PKCE only. No secret was issued."
          }
        />
        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <Button variant="ghost" asChild>
            <Link to="/applications">All applications</Link>
          </Button>
          <Button
            onClick={() =>
              void navigate({
                to: "/applications/$clientId",
                params: { clientId: created.clientId },
              })
            }
          >
            Open application
            <ArrowRight aria-hidden="true" />
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <div>
        <Button variant="ghost" size="sm" className="-ml-2 text-muted-foreground" asChild>
          <Link to="/applications">
            <ArrowLeft aria-hidden="true" />
            Applications
          </Link>
        </Button>
        <h1 className="mt-3 text-3xl font-extrabold tracking-tight sm:text-4xl">New application</h1>
        <p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground">
          Register an app that signs people in with PoliNetwork, or a service that calls PoliNetwork
          APIs. Credentials appear once you save.
        </p>
      </div>
      {apiAccess && isMasterAdmin && (
        <section aria-labelledby="presets" className="space-y-3">
          <div>
            <h2 id="presets" className="text-sm font-semibold">
              Start from a preset
            </h2>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              Fills in the reviewed settings for a PoliNetwork service. You can still change
              anything.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {CLIENT_PRESETS.map((preset) => (
              <Button
                key={preset.id}
                type="button"
                size="sm"
                variant={presetId === preset.id ? "default" : "outline"}
                aria-pressed={presetId === preset.id}
                title={preset.description}
                onClick={() => applyPreset(presetId === preset.id ? null : preset.id)}
              >
                {preset.name}
              </Button>
            ))}
          </div>
        </section>
      )}
      {error && (
        <p
          role="alert"
          className="rounded-xl border border-destructive bg-destructive/5 p-4 text-sm"
        >
          {error}
        </p>
      )}
      <NewApplicationWizard
        initial={initial}
        apiAccess={apiAccess}
        canGrantApiAccess={isMasterAdmin}
        busy={busy}
        serverErrors={fieldErrors}
        onSubmit={(draft) => void create(draft)}
        onCancel={() => void navigate({ to: "/applications" })}
      />
    </div>
  );
}
