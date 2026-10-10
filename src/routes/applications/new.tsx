import { createFileRoute, Link, useNavigate, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { ArrowLeft, ArrowRight, CircleCheck, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
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
  const [initial] = useState(emptyClientDraft);
  const [busy, setBusy] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<OidcClientDraftErrors | undefined>();
  const [created, setCreated] = useState<Created | null>(null);

  async function create(input: OidcClientDraft) {
    const draft = normalizeClientDraft(input);
    setBusy(true);
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
      toast.error(errorMessage(cause, "Unable to create the application."));
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
