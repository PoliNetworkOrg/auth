import { createFileRoute, Link, Outlet, useRouterState } from "@tanstack/react-router";
import { ArrowLeft, Building2, ShieldOff } from "lucide-react";
import { cn } from "cn";
import type { OidcAdminPolicy } from "@/auth/oidc-admin";
import { authClient } from "@/auth/client";
import { AppHeader } from "@/components/app-header";
import { LoginLayout, LoginPage } from "@/components/login-page";
import { useOidcAccess } from "@/components/oidc/use-oidc-access";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/access")({
  head: () => ({ meta: [{ title: "Roles and permissions · PoliNetwork Auth" }] }),
  component: AccessLayout,
});

const tabs = [
  { to: "/access/roles", label: "Roles" },
  { to: "/access/permissions", label: "Permissions" },
] as const;

function NoAccess({ policy }: { policy: OidcAdminPolicy | null }) {
  return (
    <div className="mx-auto max-w-lg py-10 text-center">
      <div className="mx-auto flex size-14 items-center justify-center rounded-2xl border bg-card text-muted-foreground">
        <ShieldOff className="size-6" aria-hidden="true" />
      </div>
      <h1 className="mt-6 text-2xl font-bold tracking-tight">
        Roles are managed by PoliNetwork staff
      </h1>
      <p className="mt-3 text-sm leading-6 text-muted-foreground">
        {policy === "entra-group"
          ? "Editing roles and permissions is limited to members of the PoliNetwork Entra administrators group. Ask an administrator to add your PoliNetwork Microsoft account."
          : "Editing roles and permissions requires a PoliNetwork Microsoft account. Link your PoliNetwork APS account from your account page, then come back here."}
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-3">
        <Button asChild>
          <Link to="/">
            <Building2 aria-hidden="true" />
            Go to your account
          </Link>
        </Button>
      </div>
    </div>
  );
}

function AccessLayout() {
  const { data: session, isPending, error, refetch } = authClient.useSession();
  const access = useOidcAccess(!!session);
  const pathname = useRouterState({ select: (state) => state.location.pathname });

  if (isPending) {
    return (
      <LoginLayout>
        <p role="status" className="text-center text-sm text-muted-foreground">
          Loading your session…
        </p>
      </LoginLayout>
    );
  }
  if (error) {
    return (
      <LoginLayout>
        <div className="space-y-4 text-center">
          <p role="alert">Unable to load your session. Please try again.</p>
          <Button onClick={() => void refetch()}>Try again</Button>
        </div>
      </LoginLayout>
    );
  }
  if (!session) return <LoginPage callbackURL="/access/roles" />;

  return (
    <div className="min-h-screen">
      <AppHeader active="access" access={access} />
      <main className="mx-auto max-w-6xl px-5 py-10 sm:px-8 sm:py-14">
        {access.status === "allowed" ? (
          <div className="space-y-8">
            <nav aria-label="Access administration" className="flex gap-1 border-b">
              {tabs.map((tab) => {
                const current = pathname.startsWith(tab.to);
                return (
                  <Link
                    key={tab.to}
                    to={tab.to}
                    aria-current={current ? "page" : undefined}
                    className={cn(
                      "-mb-px border-b-2 px-4 py-2.5 text-sm font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      current
                        ? "border-primary text-foreground"
                        : "border-transparent text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {tab.label}
                  </Link>
                );
              })}
            </nav>
            <Outlet />
          </div>
        ) : access.status === "denied" ? (
          <NoAccess policy={access.policy} />
        ) : access.status === "error" ? (
          <div className="mx-auto max-w-lg space-y-4 py-10 text-center">
            <p role="alert">We couldn't check whether you can manage roles.</p>
            <div className="flex flex-wrap justify-center gap-3">
              <Button onClick={access.retry}>Try again</Button>
              <Button variant="ghost" asChild>
                <Link to="/">
                  <ArrowLeft aria-hidden="true" />
                  Back to account
                </Link>
              </Button>
            </div>
          </div>
        ) : (
          <p role="status" className="py-10 text-center text-sm text-muted-foreground">
            Checking your access…
          </p>
        )}
        <footer className="mt-12 flex flex-wrap items-start justify-between gap-4 border-t pt-6 text-xs leading-5 text-muted-foreground">
          <p>PoliNetwork APS</p>
          <p className="max-w-md sm:text-right">
            Changes apply to new sign-ins immediately. Already-issued tokens expire within minutes.
          </p>
        </footer>
      </main>
    </div>
  );
}
