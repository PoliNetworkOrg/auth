import { type ErrorComponentProps, Link, useLocation, useRouter } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { ArrowLeft, ShieldOff } from "lucide-react";
import { AppHeader, type Section } from "@/components/app-header";
import { LoginPage } from "@/components/login-page";
import { Button } from "@/components/ui/button";
import { ActionError, errorMessage } from "@/lib/action-error";

/** The page frame shared by the signed-in sections: header, content, and footer note. */
export function SectionShell({
  active,
  note = "Changes apply to new sign-ins immediately. Already-issued tokens expire within minutes.",
  children,
}: {
  /** The section to highlight in the header; none for pages outside the sections. */
  active?: Section;
  note?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="min-h-screen">
      <AppHeader active={active} />
      <main className="mx-auto max-w-6xl px-5 py-10 sm:px-8 sm:py-14">
        {children}
        <footer className="mt-12 flex flex-wrap items-start justify-between gap-4 border-t pt-6 text-xs leading-5 text-muted-foreground">
          <p>PoliNetwork APS</p>
          <p className="sm:text-right">{note}</p>
        </footer>
      </main>
    </div>
  );
}

/** Shown in place of a page someone reached without the permission it needs. */
export function NoAccess({
  title = "You don't have access to this page",
  permission,
  children,
  back = { to: "/", label: "Back to account" },
}: {
  title?: string;
  permission?: string;
  children?: ReactNode;
  back?: { to: "/" | "/access" | "/applications" | "/users"; label: string };
}) {
  return (
    <div className="mx-auto max-w-lg py-10 text-center">
      <div className="mx-auto flex size-14 items-center justify-center rounded-2xl border bg-card text-muted-foreground">
        <ShieldOff className="size-6" aria-hidden="true" />
      </div>
      <h1 className="mt-6 text-2xl font-bold tracking-tight">{title}</h1>
      <p className="mt-3 text-sm leading-6 text-muted-foreground">
        {children ??
          (permission ? (
            <>
              It needs the <code className="font-mono text-xs">{permission}</code> permission. Ask
              an administrator to give you a role that grants it.
            </>
          ) : (
            "Ask an administrator to give you a role that grants it."
          ))}
      </p>
      <div className="mt-6">
        <Button variant="ghost" asChild>
          <Link to={back.to}>
            <ArrowLeft aria-hidden="true" />
            {back.label}
          </Link>
        </Button>
      </div>
    </div>
  );
}

function statusOf(error: unknown) {
  return error instanceof ActionError ? error.status : undefined;
}

/**
 * What a route shows when its guard or loader fails: the sign-in page when the session is
 * gone, a no-access page when a permission is missing, otherwise the error with a retry.
 * Retrying invalidates the router, which runs the loaders again and resets this boundary.
 */
export function RouteError({
  error,
  noAccess,
}: Pick<ErrorComponentProps, "error"> & { noAccess?: ReactNode }) {
  const router = useRouter();
  const href = useLocation({ select: (location) => location.href });
  const status = statusOf(error);
  if (status === 401) return <LoginPage callbackURL={href} />;
  if (status === 403)
    return (
      noAccess ?? (
        <NoAccess permission={error instanceof ActionError ? error.permission : undefined} />
      )
    );
  return (
    <div className="mx-auto max-w-lg space-y-4 py-10 text-center">
      <p role="alert">
        {status === 404
          ? errorMessage(error, "This page no longer exists.")
          : errorMessage(error, "Something went wrong.")}
      </p>
      <div className="flex flex-wrap justify-center gap-3">
        {status !== 404 && <Button onClick={() => void router.invalidate()}>Try again</Button>}
        <Button variant="ghost" asChild>
          <Link to="/">
            <ArrowLeft aria-hidden="true" />
            Back to account
          </Link>
        </Button>
      </div>
    </div>
  );
}

/**
 * The error component body for a section layout. Signing in replaces the whole page;
 * anything else keeps the section's header around it.
 */
export function SectionError({
  error,
  active,
  noAccess,
  note,
}: Pick<ErrorComponentProps, "error"> & {
  active: Section;
  noAccess?: ReactNode;
  note?: ReactNode;
}) {
  if (statusOf(error) === 401) return <RouteError error={error} />;
  return (
    <SectionShell active={active} note={note}>
      <RouteError error={error} noAccess={noAccess} />
    </SectionShell>
  );
}

/** For an address no route matches. */
export function NotFoundPage() {
  return (
    <SectionShell note={null}>
      <div className="mx-auto max-w-lg space-y-4 py-10 text-center">
        <h1 className="text-2xl font-bold tracking-tight">This page doesn't exist</h1>
        <p className="text-sm leading-6 text-muted-foreground">
          Check the address, or go back to your account.
        </p>
        <Button variant="ghost" asChild>
          <Link to="/">
            <ArrowLeft aria-hidden="true" />
            Back to account
          </Link>
        </Button>
      </div>
    </SectionShell>
  );
}

export function PendingPage() {
  return (
    <p role="status" className="py-10 text-center text-sm text-muted-foreground">
      Loading…
    </p>
  );
}
