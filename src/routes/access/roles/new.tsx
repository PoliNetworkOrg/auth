import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { ArrowLeft } from "lucide-react";
import { type RbacDraftErrors, type RoleDraft, emptyRoleDraft } from "@/auth/rbac";
import { getCatalog, saveRoleFn } from "@/auth/rbac.functions";
import { requireAccess } from "@/components/access";
import { RoleForm } from "@/components/rbac/role-form";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { errorFields, errorMessage } from "@/lib/action-error";

export const Route = createFileRoute("/access/roles/new")({
  head: () => ({ meta: [{ title: "New role · PoliNetwork Auth" }] }),
  beforeLoad: ({ context }) => requireAccess(context.viewer, "idp:roles:write"),
  loader: () => getCatalog(),
  component: NewRole,
});

function NewRole() {
  const navigate = useNavigate();
  const catalog = Route.useLoaderData();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [fields, setFields] = useState<RbacDraftErrors>();

  async function create(draft: RoleDraft) {
    setBusy(true);
    setError("");
    setFields(undefined);
    try {
      const role = await saveRoleFn({ data: { draft } });
      await navigate({ to: "/access/roles/$roleId", params: { roleId: role.id } });
    } catch (cause) {
      setFields(errorFields(cause));
      setError(errorMessage(cause, "Unable to create the role."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <Button variant="ghost" size="sm" className="-ml-2 text-muted-foreground" asChild>
          <Link to="/access/roles">
            <ArrowLeft aria-hidden="true" />
            Roles
          </Link>
        </Button>
        <h2 className="mt-3 text-3xl font-extrabold tracking-tight sm:text-4xl">New role</h2>
        <p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground">
          Bundle permissions under one name, then give it to people from the role's page.
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
          <RoleForm
            mode="create"
            initial={emptyRoleDraft()}
            catalog={catalog}
            busy={busy}
            serverErrors={fields}
            submitLabel="Create role"
            onSubmit={(draft) => void create(draft)}
            onCancel={() => void navigate({ to: "/access/roles" })}
          />
        </CardContent>
      </Card>
    </div>
  );
}
