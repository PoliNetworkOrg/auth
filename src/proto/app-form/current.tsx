// PROTOTYPE (proto/app-form): the shipped form, unchanged, as the baseline.
import { ClientForm } from "@/components/oidc/client-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { VariantProps } from "./shared";

export function Current(props: VariantProps) {
  const form = (
    <ClientForm
      mode={props.mode}
      initial={props.initial}
      savedCredential={props.savedCredential}
      apiAccess={props.apiAccess}
      canGrantApiAccess={props.canGrantApiAccess}
      busy={false}
      submitLabel={props.mode === "create" ? "Create application" : "Save changes"}
      onSubmit={props.onSubmit}
    />
  );
  if (props.mode === "create")
    return (
      <Card>
        <CardContent className="pt-6">{form}</CardContent>
      </Card>
    );
  return (
    <Card>
      <CardHeader>
        <CardTitle>Settings</CardTitle>
        <CardDescription>
          Changes apply to the next sign-in or token request. Redirect URIs must match your app
          exactly.
        </CardDescription>
      </CardHeader>
      <CardContent>{form}</CardContent>
    </Card>
  );
}
