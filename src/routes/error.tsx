import { createFileRoute } from "@tanstack/react-router";
import { Clock, ShieldOff, TriangleAlert, UserRoundX, X } from "lucide-react";
import type { ReactNode } from "react";
import { z } from "zod";
import { describeError, errorCode, errorKind, type ErrorKind } from "@/auth/sign-in-errors";
import { getErrorApp } from "@/auth/sign-in-errors.functions";
import { useViewer } from "@/components/access";
import { LoginLayout } from "@/components/login-page";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

// The router reads JSON-looking values as JSON, so a numeric value arrives as a number.
const text = z.union([z.string(), z.number()]).transform(String).optional().catch(undefined);

const searchSchema = z.object({
  error: text,
  /** The provider whose callback failed, when one did. */
  provider: text,
  /** A signed context from `routeCallbackError`: the application the sign-in belonged to. */
  app: text,
  /** Seconds to wait, after too many attempts. No rate limit here lasts longer than an hour. */
  retry_after: z.coerce.number().int().positive().max(3600).optional().catch(undefined),
});

/**
 * Where a failed sign-in or link ends when it can't go straight back to an application: Better
 * Auth, the provider plugin and `routeCallbackError` all send people here. It says what happened
 * and what to do next, and inside an application's sign-in it offers to start it again or to go
 * back to the application. Only fixed copy is shown, never text from the URL.
 */
export const Route = createFileRoute("/error")({
  head: () => ({
    meta: [{ title: "Sign-in problem · PoliNetwork Auth" }, { name: "robots", content: "noindex" }],
  }),
  validateSearch: searchSchema,
  loaderDeps: ({ search }) => ({ error: errorCode(search.error), app: search.app }),
  loader: ({ deps }) => (deps.app ? getErrorApp({ data: deps }) : null),
  component: ErrorPage,
});

const ICONS: Record<ErrorKind, ReactNode> = {
  cancelled: <X />,
  refused: <ShieldOff />,
  "account-in-use": <UserRoundX />,
  expired: <Clock />,
  lost: <TriangleAlert />,
  "rate-limited": <Clock />,
  application: <ShieldOff />,
  failed: <TriangleAlert />,
};

function ErrorPage() {
  const viewer = useViewer();
  const app = Route.useLoaderData();
  const search = Route.useSearch();
  const code = errorCode(search.error);
  const copy = describeError(code, { provider: search.provider, retryAfter: search.retry_after });

  return (
    <LoginLayout wide>
      <Card>
        <CardContent className="flex flex-col items-center gap-4 px-6 py-10 text-center">
          <div className="flex size-12 items-center justify-center rounded-2xl border bg-background text-muted-foreground [&>svg]:size-5">
            {ICONS[errorKind(code)]}
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-balance">{copy.title}</h1>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">{copy.message}</p>
          </div>
          <div className="mt-2 grid w-full gap-3">
            {app ? (
              <>
                <Button asChild className="h-11">
                  <a href={app.retryHref}>Try again</a>
                </Button>
                <Button asChild variant="outline" className="h-11 bg-card">
                  <a href={app.backHref}>Back to {app.name}</a>
                </Button>
              </>
            ) : (
              <Button asChild className="h-11">
                <a href="/">{viewer ? "Your account" : "Back to sign in"}</a>
              </Button>
            )}
          </div>
          {copy.showCode && (
            <p className="text-xs text-muted-foreground">
              Error code: <code className="font-mono">{code}</code>
            </p>
          )}
        </CardContent>
      </Card>
    </LoginLayout>
  );
}
