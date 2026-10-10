import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { ArrowLeft } from "lucide-react";
import { type PermissionDraft, type RbacDraftErrors, emptyPermissionDraft } from "@/auth/rbac";
import { getCatalog, savePermissionFn } from "@/auth/rbac.functions";
import { requireAccess } from "@/components/access";
import { PermissionForm } from "@/components/rbac/permission-form";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { errorFields, errorMessage } from "@/lib/action-error";

export const Route = createFileRoute("/access/permissions/new")({
  head: () => ({ meta: [{ title: "New permission · PoliNetwork Auth" }] }),
  beforeLoad: ({ context }) => requireAccess(context.viewer, "idp:permissions:write"),
  loader: () => getCatalog(),
  component: NewPermission,
});

function NewPermission() {
  const navigate = useNavigate();
  const catalog = Route.useLoaderData();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [fields, setFields] = useState<RbacDraftErrors>();

  async function create(draft: PermissionDraft) {
    setBusy(true);
    setError("");
    setFields(undefined);
    try {
      const permission = await savePermissionFn({ data: { draft } });
      await navigate({
        to: "/access/permissions/$permissionId",
        params: { permissionId: permission.id },
      });
    } catch (cause) {
      setFields(errorFields(cause));
      setError(errorMessage(cause, "Unable to create the permission."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <Button variant="ghost" size="sm" className="-ml-2 text-muted-foreground" asChild>
          <Link to="/access/permissions">
            <ArrowLeft aria-hidden="true" />
            Permissions
          </Link>
        </Button>
        <h2 className="mt-3 text-3xl font-extrabold tracking-tight sm:text-4xl">New permission</h2>
        <p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground">
          Applications check for the key you choose here, so pick one you can live with.
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
          <PermissionForm
            mode="create"
            initial={emptyPermissionDraft()}
            catalog={catalog}
            busy={busy}
            serverErrors={fields}
            submitLabel="Create permission"
            onSubmit={(draft) => void create(draft)}
            onCancel={() => void navigate({ to: "/access/permissions" })}
          />
        </CardContent>
      </Card>
    </div>
  );
}
