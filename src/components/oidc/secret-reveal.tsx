import { KeyRound, TriangleAlert } from "lucide-react";
import { CopyButton } from "@/components/copy-button";

export function CredentialField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <div className="mt-1 flex items-center gap-2 rounded-lg border bg-background px-3 py-2">
        <code className="min-w-0 flex-1 font-mono text-sm break-all select-all">{value}</code>
        <CopyButton value={value} label={`Copy ${label.toLowerCase()}`} />
      </div>
    </div>
  );
}

export function CredentialsReveal({
  clientId,
  clientSecret,
  title,
  description,
}: {
  clientId: string;
  clientSecret?: string | null;
  title: string;
  description: string;
}) {
  return (
    <section
      aria-label={title}
      className="space-y-4 rounded-2xl border border-primary/40 bg-primary/5 p-5"
    >
      <div className="flex items-start gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground">
          <KeyRound className="size-5" aria-hidden="true" />
        </div>
        <div>
          <h3 className="text-base font-semibold">{title}</h3>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">{description}</p>
        </div>
      </div>
      <CredentialField label="Client ID" value={clientId} />
      {clientSecret && (
        <>
          <CredentialField label="Client secret" value={clientSecret} />
          <p className="flex items-start gap-2 text-xs leading-5 text-muted-foreground">
            <TriangleAlert
              className="mt-0.5 size-3.5 shrink-0 text-destructive"
              aria-hidden="true"
            />
            The secret is shown only this once. Store it in your app's secret manager; if it leaks,
            rotate it from this page.
          </p>
        </>
      )}
    </section>
  );
}
