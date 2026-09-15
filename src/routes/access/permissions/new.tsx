import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { ArrowLeft } from "lucide-react";
import { type PermissionDraft, type RbacDraftErrors, emptyPermissionDraft } from "@/auth/rbac";
import { RbacApiError, errorMessage, savePermission } from "@/components/rbac/api";
import { PermissionForm } from "@/components/rbac/permission-form";
import { RequirePermission } from "@/components/rbac/require-permission";
import { useCatalog } from "@/components/rbac/use-catalog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export const Route = createFileRoute("/access/permissions/new")({
  head: () => ({ meta: [{ title: "New permission · PoliNetwork Auth" }] }),
  component: GuardedNewPermission,
});

function NewPermission() {
  const navigate = useNavigate();
  const { catalog, loading } = useCatalog();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [fields, setFields] = useState<RbacDraftErrors>();

  async function create(draft: PermissionDraft) {
    setBusy(true);
    setError("");
    setFields(undefined);
    try {
      const permission = await savePermission(draft);
      await navigate({
        to: "/access/permissions/$permissionId",
        params: { permissionId: permission.id },
      });
    } catch (cause) {
      if (cause instanceof RbacApiError) setFields(cause.fields);
      setError(errorMessage(cause, "Unable to create the permission."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <div>
        <Button variant="ghost" size="sm" className="-ml-2 text-muted-foreground" asChild>
          <Link to="/access/permissions">
            <ArrowLeft aria-hidden="true" />
            Permissions
          </Link>
        </Button>
        <h1 className="mt-3 text-3xl font-extrabold tracking-tight sm:text-4xl">New permission</h1>
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
          {loading ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Loading permissions…</p>
          ) : (
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
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function GuardedNewPermission() {
  return (
    <RequirePermission permission="idp:permissions:write">
      <NewPermission />
    </RequirePermission>
  );
}
