import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { ArrowLeft, ShieldOff } from "lucide-react";
import type { ManagedPermissionKey } from "@/auth/rbac";
import { useIdpAccessContext } from "@/components/idp-access";
import { Button } from "@/components/ui/button";

/**
 * Hides a page from someone who reached it without the permission it needs. The server
 * enforces the same permission on every endpoint; this only keeps the UI honest.
 */
export function RequirePermission({
  permission,
  children,
}: {
  permission: ManagedPermissionKey;
  children: ReactNode;
}) {
  const { can } = useIdpAccessContext();
  if (can(permission)) return children;
  return (
    <div className="mx-auto max-w-lg py-10 text-center">
      <div className="mx-auto flex size-14 items-center justify-center rounded-2xl border bg-card text-muted-foreground">
        <ShieldOff className="size-6" aria-hidden="true" />
      </div>
      <h1 className="mt-6 text-2xl font-bold tracking-tight">You don't have access to this page</h1>
      <p className="mt-3 text-sm leading-6 text-muted-foreground">
        It needs the <code className="font-mono text-xs">{permission}</code> permission. Ask an
        administrator to give you a role that grants it.
      </p>
      <div className="mt-6">
        <Button variant="ghost" asChild>
          <Link to="/access">
            <ArrowLeft aria-hidden="true" />
            Back to access administration
          </Link>
        </Button>
      </div>
    </div>
  );
}
