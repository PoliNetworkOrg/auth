import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { CircleCheck, Clock, LoaderCircle, LogOut, ShieldOff, TriangleAlert } from "lucide-react";
import { z } from "zod";
import { useViewer } from "@/components/access";
import { LoginLayout } from "@/components/login-page";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { UserAvatar } from "@/components/user-avatar";
import { LOGOUT_CONFIRM_PATH, type LogoutErrorReason } from "@/auth/logout-page";

const searchSchema = z.object({
  status: z.enum(["confirm", "done", "error"]).catch("confirm").default("confirm"),
  redirect: z.literal("unregistered").optional().catch(undefined),
  reason: z.enum(["expired", "client", "token", "unknown"]).optional().catch(undefined),
});

export const Route = createFileRoute("/logout")({
  head: () => ({ meta: [{ title: "Sign out · PoliNetwork Auth" }] }),
  validateSearch: searchSchema,
  component: Logout,
});

const errors: Record<LogoutErrorReason, { icon: typeof LogOut; title: string; body: string }> = {
  expired: {
    icon: Clock,
    title: "This sign-out request has expired",
    body: "Sign-out requests are only valid for a few minutes. Start again from the application you were using.",
  },
  client: {
    icon: ShieldOff,
    title: "This application can't sign you out",
    body: "It isn't registered with PoliNetwork or isn't allowed to end sessions. You're still signed in.",
  },
  token: {
    icon: TriangleAlert,
    title: "We couldn't verify this request",
    body: "The application sent a sign-in token we couldn't check. Start again from the application.",
  },
  unknown: {
    icon: TriangleAlert,
    title: "We couldn't sign you out",
    body: "Something went wrong with this request. Start again from the application you were using.",
  },
};

function Notice({
  icon: Icon,
  title,
  children,
  action,
}: {
  icon: typeof LogOut;
  title: string;
  children: React.ReactNode;
  action: React.ReactNode;
}) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-4 px-6 py-10 text-center">
        <div className="flex size-12 items-center justify-center rounded-2xl border bg-background text-muted-foreground">
          <Icon className="size-5" aria-hidden="true" />
        </div>
        <div>
          <h1 className="text-xl font-bold tracking-tight text-balance">{title}</h1>
          <p className="mt-2 text-sm leading-6 text-pretty text-muted-foreground">{children}</p>
        </div>
        {action}
      </CardContent>
    </Card>
  );
}

function Logout() {
  const viewer = useViewer();
  const { status, redirect, reason } = Route.useSearch();
  const [busy, setBusy] = useState(false);

  if (status === "done") {
    return (
      <LoginLayout>
        <Notice
          icon={CircleCheck}
          title="You're signed out"
          action={
            <Button asChild variant="outline" className="h-11 w-full bg-card">
              <a href="/">Sign in again</a>
            </Button>
          }
        >
          {redirect === "unregistered"
            ? "The application's return address isn't registered, so we couldn't send you back. You can close this tab."
            : "Your PoliNetwork session on this browser has ended. You can close this tab."}
        </Notice>
      </LoginLayout>
    );
  }

  if (status === "error") {
    const error = errors[reason ?? "unknown"];
    return (
      <LoginLayout>
        <Notice
          icon={error.icon}
          title={error.title}
          action={
            <Button asChild variant="outline" className="h-11 w-full bg-card">
              <a href="/">Go to your account</a>
            </Button>
          }
        >
          {error.body}
        </Notice>
      </LoginLayout>
    );
  }

  return (
    <LoginLayout>
      <Card>
        <CardContent className="space-y-6 px-6 pt-8 pb-8">
          <div className="flex flex-col items-center gap-4 text-center">
            <div className="flex size-12 items-center justify-center rounded-2xl border bg-background text-muted-foreground">
              <LogOut className="size-5" aria-hidden="true" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Sign out?</h1>
              <p className="mt-2 text-sm leading-6 text-pretty text-muted-foreground">
                An application asked to end your PoliNetwork session on this browser.
              </p>
            </div>
          </div>

          {viewer && (
            <div className="flex items-center gap-3 rounded-xl border bg-muted/40 p-3">
              <div className="size-9 shrink-0 overflow-hidden rounded-full border bg-background text-xs font-semibold text-muted-foreground">
                <UserAvatar name={viewer.user.name} image={viewer.user.image} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{viewer.user.name}</p>
                <p className="truncate text-xs text-muted-foreground">{viewer.user.email}</p>
              </div>
            </div>
          )}

          {/* A native post, so the plugin's signed confirmation cookie goes with it. */}
          <form
            method="post"
            action={LOGOUT_CONFIRM_PATH}
            className="flex flex-col-reverse gap-3 sm:grid sm:grid-cols-2"
            onSubmit={() => setBusy(true)}
          >
            <Button asChild variant="outline" className="h-11 bg-card">
              <a href="/">Stay signed in</a>
            </Button>
            <Button type="submit" name="action" value="confirm" className="h-11" disabled={busy}>
              {busy && <LoaderCircle className="animate-spin" aria-hidden="true" />}
              Sign out
            </Button>
          </form>
        </CardContent>
      </Card>
    </LoginLayout>
  );
}
