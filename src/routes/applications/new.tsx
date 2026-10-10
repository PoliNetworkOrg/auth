import { createFileRoute, Link, useNavigate, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { ArrowLeft, ArrowRight, CircleCheck } from "lucide-react";
import { authClient } from "@/auth/client";
import {
  emptyClientDraft,
  grantTypesForScopes,
  normalizeClientDraft,
  type OidcClientDraft,
} from "@/auth/oidc-clients";
import { ClientForm } from "@/components/oidc/client-form";
import { CredentialsReveal } from "@/components/oidc/secret-reveal";
import { requireAccess } from "@/components/access";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { errorMessage } from "@/lib/action-error";

export const Route = createFileRoute("/applications/new")({
  head: () => ({ meta: [{ title: "New application · PoliNetwork Auth" }] }),
  beforeLoad: ({ context }) => requireAccess(context.viewer, "idp:applications:write"),
  component: NewApplication,
});

type Created = { clientId: string; clientSecret: string | null; name: string };

function NewApplication() {
  const navigate = useNavigate();
  const router = useRouter();
  const [confidential, setConfidential] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [created, setCreated] = useState<Created | null>(null);

  async function create(input: OidcClientDraft) {
    const draft = normalizeClientDraft(input);
    setBusy(true);
    setError("");
    try {
      const body: Parameters<typeof authClient.oauth2.createClient>[0] = {
        client_name: draft.name,
        redirect_uris: draft.redirectUris,
        scope: draft.scopes.join(" "),
        grant_types: grantTypesForScopes(draft.scopes),
        response_types: ["code"],
        application_type: draft.applicationType,
        token_endpoint_auth_method: confidential ? "client_secret_basic" : "none",
      };
      if (draft.uri) body.client_uri = draft.uri;
      if (draft.logo) body.logo_uri = draft.logo;
      if (draft.tosUri) body.tos_uri = draft.tosUri;
      if (draft.policyUri) body.policy_uri = draft.policyUri;
      if (draft.contacts.length) body.contacts = draft.contacts;
      if (draft.postLogoutRedirectUris.length)
        body.post_logout_redirect_uris = draft.postLogoutRedirectUris;
      const result = await authClient.oauth2.createClient(body);
      if (result.error) {
        setError(result.error.message ?? "Unable to create the application.");
        return;
      }
      // Drops any cached copy of the list, which doesn't have the new application yet.
      await router.invalidate({ sync: true });
      setCreated({
        clientId: result.data.client_id,
        clientSecret: result.data.client_secret ?? null,
        name: draft.name,
      });
      window.scrollTo({ top: 0 });
    } catch (cause) {
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
            Configure your app with these credentials. You can edit everything else later.
          </p>
        </div>
        <CredentialsReveal
          clientId={created.clientId}
          clientSecret={created.clientSecret}
          title={created.clientSecret ? "Save your client secret now" : "Your client ID"}
          description={
            created.clientSecret
              ? "Your app authenticates to the token endpoint with this client ID and secret."
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
    <div className="mx-auto max-w-3xl space-y-8">
      <div>
        <Button variant="ghost" size="sm" className="-ml-2 text-muted-foreground" asChild>
          <Link to="/applications">
            <ArrowLeft aria-hidden="true" />
            Applications
          </Link>
        </Button>
        <h1 className="mt-3 text-3xl font-extrabold tracking-tight sm:text-4xl">New application</h1>
        <p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground">
          Register a service so it can offer “Sign in with PoliNetwork”. Credentials appear once you
          save.
        </p>
      </div>
      {error && (
        <p
          role="alert"
          className="rounded-xl border border-destructive bg-destructive/5 p-4 text-sm"
        >
          {error}
        </p>
      )}
      <Card>
        <CardContent className="pt-6">
          <ClientForm
            mode="create"
            initial={emptyClientDraft()}
            confidential={confidential}
            onConfidentialChange={setConfidential}
            busy={busy}
            submitLabel="Create application"
            onSubmit={(draft) => void create(draft)}
            onCancel={() => void navigate({ to: "/applications" })}
          />
        </CardContent>
      </Card>
    </div>
  );
}
