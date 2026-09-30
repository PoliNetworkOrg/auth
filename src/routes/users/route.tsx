import { createFileRoute, Link, Outlet } from "@tanstack/react-router";
import { ArrowLeft, Building2, ShieldOff } from "lucide-react";
import { authClient } from "@/auth/client";
import { AppHeader } from "@/components/app-header";
import { LoginLayout, LoginPage } from "@/components/login-page";
import { IdpAccessProvider, useIdpAccess } from "@/components/idp-access";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/users")({
  head: () => ({ meta: [{ title: "Users · PoliNetwork Auth" }] }),
  component: UsersLayout,
});

function NoAccess() {
  return (
    <div className="mx-auto max-w-lg py-10 text-center">
      <div className="mx-auto flex size-14 items-center justify-center rounded-2xl border bg-card text-muted-foreground">
        <ShieldOff className="size-6" aria-hidden="true" />
      </div>
      <h1 className="mt-6 text-2xl font-bold tracking-tight">
        The user directory is for PoliNetwork staff
      </h1>
      <p className="mt-3 text-sm leading-6 text-muted-foreground">
        It needs the <code className="font-mono text-xs">idp:users:read</code> permission. Ask an
        administrator to give you a role that grants it.
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

function UsersLayout() {
  const { data: session, isPending, error, refetch } = authClient.useSession();
  const access = useIdpAccess(!!session);

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
  if (!session) return <LoginPage callbackURL="/users" />;

  return (
    <div className="min-h-screen">
      <AppHeader active="users" access={access} />
      <main className="mx-auto max-w-6xl px-5 py-10 sm:px-8 sm:py-14">
        {access.status === "ready" && access.can("idp:users:read") ? (
          <IdpAccessProvider access={access}>
            <Outlet />
          </IdpAccessProvider>
        ) : access.status === "ready" ? (
          <NoAccess />
        ) : access.status === "error" ? (
          <div className="mx-auto max-w-lg space-y-4 py-10 text-center">
            <p role="alert">We couldn't check whether you can see the user directory.</p>
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
            Role changes apply to new sign-ins immediately. Already-issued tokens expire within
            minutes.
          </p>
        </footer>
      </main>
    </div>
  );
}
