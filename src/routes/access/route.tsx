import { createFileRoute, Link, Outlet, useRouterState } from "@tanstack/react-router";
import { ArrowLeft, Building2, ShieldOff } from "lucide-react";
import { cn } from "cn";
import { authClient } from "@/auth/client";
import { AppHeader } from "@/components/app-header";
import { LoginLayout, LoginPage } from "@/components/login-page";
import { IdpAccessProvider, useIdpAccess } from "@/components/idp-access";
import { ACCESS_TABS } from "@/components/rbac/access-tabs";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/access")({
  head: () => ({ meta: [{ title: "Roles and permissions · PoliNetwork Auth" }] }),
  component: AccessLayout,
});

function NoAccess() {
  return (
    <div className="mx-auto max-w-lg py-10 text-center">
      <div className="mx-auto flex size-14 items-center justify-center rounded-2xl border bg-card text-muted-foreground">
        <ShieldOff className="size-6" aria-hidden="true" />
      </div>
      <h1 className="mt-6 text-2xl font-bold tracking-tight">
        Roles are managed by PoliNetwork staff
      </h1>
      <p className="mt-3 text-sm leading-6 text-muted-foreground">
        Access requires role or permission administration access. Ask an administrator to grant the
        appropriate role.
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
  const access = useIdpAccess(!!session);
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  // Whatever any tab needs, rather than one fixed permission: the implication that makes
  // reading roles grant reading permissions is stored data an administrator can remove.
  const visibleTabs = ACCESS_TABS.filter((tab) => access.can(tab.permission));

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
  // Back to the section rather than a named tab: which one they may read is only
  // known after they have signed in.
  if (!session) return <LoginPage callbackURL="/access" />;

  return (
    <div className="min-h-screen">
      <AppHeader active="access" access={access} />
      <main className="mx-auto max-w-6xl px-5 py-10 sm:px-8 sm:py-14">
        {access.status === "ready" && visibleTabs.length > 0 ? (
          <div className="space-y-8">
            <nav aria-label="Access administration" className="flex gap-1 border-b">
              {visibleTabs.map((tab) => {
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
            <IdpAccessProvider access={access}>
              <Outlet />
            </IdpAccessProvider>
          </div>
        ) : access.status === "ready" ? (
          <NoAccess />
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
