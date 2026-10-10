import { useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";
import type { OidcClientSummary } from "@/auth/oidc-clients";
import { CopyButton } from "@/components/copy-button";
import { Button } from "@/components/ui/button";

/** The provider URLs an app needs to connect, behind a toggle, each in full with a copy button. */
export function EndpointDetails({ client }: { client: OidcClientSummary }) {
  const [open, setOpen] = useState(false);
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);

  const issuer = `${origin}/api/auth`;
  const signsIn = client.grantTypes.includes("authorization_code");
  // A service-only app never sends anyone to the browser endpoints.
  const rows = [
    { label: "Issuer", value: issuer },
    { label: "OIDC discovery URL", value: `${issuer}/.well-known/openid-configuration` },
    signsIn && { label: "Authorization URL", value: `${issuer}/oauth2/authorize` },
    { label: "Token URL", value: `${issuer}/oauth2/token` },
    signsIn && { label: "UserInfo URL", value: `${issuer}/oauth2/userinfo` },
    signsIn &&
      client.enableEndSession && { label: "Logout URL", value: `${issuer}/oauth2/end-session` },
    { label: "Certificate URL", value: `${issuer}/jwks` },
  ].filter((row) => !!row);

  return (
    <div>
      {open && (
        <dl id="endpoint-details" className="mb-2 space-y-3">
          {rows.map((row) => (
            <div key={row.label} className="grid gap-x-4 gap-y-0.5 sm:grid-cols-[10rem_1fr]">
              <dt className="pt-1.5 text-xs font-medium text-muted-foreground">{row.label}</dt>
              <dd className="flex items-start gap-1">
                <code className="min-w-0 pt-1.5 font-mono text-xs break-all">
                  {origin ? row.value : "…"}
                </code>
                {origin && (
                  <CopyButton
                    value={row.value}
                    label={`Copy ${row.label}`}
                    size="icon-xs"
                    className="mt-0.5 shrink-0"
                  />
                )}
              </dd>
            </div>
          ))}
        </dl>
      )}
      <div className="flex justify-center">
        <Button
          variant="ghost"
          size="sm"
          aria-expanded={open}
          aria-controls="endpoint-details"
          onClick={() => setOpen((value) => !value)}
        >
          {open ? "Hide details" : "Show more details"}
          <ChevronDown
            className={open ? "rotate-180 transition-transform" : "transition-transform"}
            aria-hidden="true"
          />
        </Button>
      </div>
    </div>
  );
}
