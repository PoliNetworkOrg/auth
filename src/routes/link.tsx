import { createFileRoute, redirect } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";
import { BadgeCheck, Link2, LoaderCircle, TriangleAlert, UserRoundX } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import { authClient } from "@/auth/client";
import {
  LINK_METHODS,
  isLinkMethod,
  linkErrorFromCallback,
  linkPagePath,
  withLinkOutcome,
  type LinkMethod,
  type LinkOutcome,
  type LinkRequest,
} from "@/auth/link-request";
import { getLinkRequest, type LinkRequestDetails } from "@/auth/link.functions";
import { useViewer } from "@/components/access";
import { LoginLayout, LoginPage } from "@/components/login-page";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription } from "@/components/ui/card";
import { UserAvatar } from "@/components/user-avatar";

// The router reads JSON-looking values as JSON, so a numeric client ID arrives as a number.
const text = z.union([z.string(), z.number()]).transform(String).optional().catch(undefined);

const searchSchema = z.object({
  method: text,
  client_id: text,
  return_to: text,
  /** Set by the link's own callbacks, on the way back from the provider. */
  result: z.enum(["linked", "failed"]).optional().catch(undefined),
  /** Appended by Better Auth to the error callback. */
  error: text,
});

type LinkPageData =
  | { status: "invalid" }
  | ({
      status: "unavailable" | "sign-in" | "confirm" | "already-linked";
      request: LinkRequest;
    } & LinkRequestDetails)
  | ({ status: "outcome"; request: LinkRequest; outcome: LinkOutcome } & LinkRequestDetails);

/**
 * Where an application sends a signed-in person to link one login method, and gets them back:
 * `/link?method=telegram|pn-entra|google&client_id=…&return_to=…`. Nothing changes until the
 * person confirms. `return_to` is used only when it's one of the application's own addresses;
 * otherwise the page stays on PoliNetwork Auth. The integration guide documents it.
 */
export const Route = createFileRoute("/link")({
  head: () => ({ meta: [{ title: "Link an account · PoliNetwork Auth" }] }),
  validateSearch: searchSchema,
  loaderDeps: ({ search }) => search,
  loader: async ({ context, deps }): Promise<LinkPageData> => {
    const { method } = deps;
    if (!isLinkMethod(method)) return { status: "invalid" };
    const details = await getLinkRequest({
      data: { method, clientId: deps.client_id, returnTo: deps.return_to },
    });
    // Carries the application on only when its return address is trusted.
    const request: LinkRequest = details.returnTo
      ? { method, clientId: deps.client_id, returnTo: details.returnTo }
      : { method };

    if (deps.result) {
      const outcome: LinkOutcome =
        deps.result === "linked"
          ? details.linked
            ? { linked: method }
            : { error: "failed" }
          : { error: linkErrorFromCallback(deps.error) };
      // A login that belongs to someone else is explained here first: the application can't.
      const explainFirst = "error" in outcome && outcome.error === "account_in_use";
      if (details.returnTo && !explainFirst)
        throw redirect({ href: withLinkOutcome(details.returnTo, outcome) });
      return { status: "outcome", request, outcome, ...details };
    }

    const available =
      method === "telegram"
        ? context.providers.link.includes(method)
        : context.providers.signIn.includes(method);
    const status = !available
      ? "unavailable"
      : !context.viewer
        ? "sign-in"
        : details.linked
          ? "already-linked"
          : "confirm";
    return { status, request, ...details };
  },
  component: LinkPage,
});

function LinkPage() {
  const data = Route.useLoaderData();
  if (data.status === "invalid") {
    return (
      <Notice icon={<TriangleAlert />} title="This link isn't valid">
        It doesn't say which account to link. Go back to the application and try again.
        <Actions>
          <AccountButton />
        </Actions>
      </Notice>
    );
  }
  return <LinkStep data={data} />;
}

function LinkStep({ data }: { data: Extract<LinkPageData, { request: LinkRequest }> }) {
  const viewer = useViewer();
  const [busy, setBusy] = useState<"link" | "switch" | null>(null);
  const { request, app, returnTo } = data;
  const method = LINK_METHODS[request.method];
  const appName = app?.name ?? null;

  async function link() {
    setBusy("link");
    try {
      const result = await authClient.linkSocial({
        provider: request.method,
        callbackURL: linkPagePath(request, "linked"),
        errorCallbackURL: linkPagePath(request, "failed"),
      });
      // On success the auth client is already on its way to the provider: stay busy.
      if (!result.error) return;
      toast.error(result.error.message ?? `Unable to link ${method.name}. Please try again.`);
    } catch {
      toast.error("Unable to reach PoliNetwork. Please try again.");
    }
    setBusy(null);
  }

  async function switchAccount() {
    setBusy("switch");
    try {
      await authClient.signOut();
    } finally {
      window.location.assign(linkPagePath(request));
    }
  }

  const back = (outcome: LinkOutcome) =>
    returnTo && appName ? (
      <BackButton href={withLinkOutcome(returnTo, outcome)} app={appName} />
    ) : null;

  switch (data.status) {
    case "sign-in":
      return (
        <LoginPage
          callbackURL={linkPagePath(request)}
          header={
            <>
              <MethodMark method={request.method} />
              <h1 className="mt-5 text-2xl font-bold tracking-tight text-balance">
                Sign in to link {method.name}
              </h1>
              <CardDescription>
                {appName ? (
                  <>
                    <span className="font-medium text-foreground">{appName}</span> asks you to link
                    your {method.name} account.{" "}
                  </>
                ) : null}
                First, sign in to your PoliNetwork account
                {request.method === "telegram" ? ". Telegram can't be used to sign in." : "."}
              </CardDescription>
            </>
          }
        />
      );

    case "unavailable":
      return (
        <Notice icon={<TriangleAlert />} title={`${method.name} can't be linked right now`}>
          PoliNetwork Auth isn't set up to link {method.name} accounts at the moment. Try again
          later, or ask the IT team.
          <Actions>{back({ error: "unavailable" }) ?? <AccountButton />}</Actions>
        </Notice>
      );

    case "already-linked":
      return (
        <Notice
          icon={<MethodMark method={request.method} />}
          title={`Your ${method.name} account is already linked`}
        >
          There's nothing else to do here.
          <Actions>{back({ linked: request.method }) ?? <AccountButton primary />}</Actions>
        </Notice>
      );

    case "outcome":
      return <Outcome data={data} back={back} />;

    case "confirm":
      return (
        <LoginLayout wide>
          <Card>
            <CardContent className="space-y-6 px-6 pt-8 pb-8 sm:px-8">
              <MethodMark method={request.method} />
              <div className="text-center">
                <h1 className="text-2xl font-bold tracking-tight text-balance">
                  {appName ? (
                    <>
                      <span className="text-primary">{appName}</span> asks you to link your{" "}
                      {method.name} account to PoliNetwork Auth
                    </>
                  ) : (
                    <>Link your {method.name} account to PoliNetwork Auth</>
                  )}
                </h1>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  {METHOD_PURPOSE[request.method]}
                </p>
              </div>

              {viewer && (
                <div className="flex items-center gap-3 rounded-xl border bg-muted/40 p-3">
                  <div className="size-9 shrink-0 overflow-hidden rounded-full border bg-background text-xs font-semibold text-muted-foreground">
                    <UserAvatar name={viewer.user.name} image={viewer.user.image} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{viewer.user.name}</p>
                    <p className="text-xs text-muted-foreground">Signed in to PoliNetwork</p>
                  </div>
                  <Button
                    type="button"
                    variant="link"
                    size="sm"
                    className="shrink-0"
                    disabled={busy !== null}
                    onClick={() => void switchAccount()}
                  >
                    {busy === "switch" && (
                      <LoaderCircle className="animate-spin" aria-hidden="true" />
                    )}
                    Not you?
                  </Button>
                </div>
              )}

              <div className="grid gap-3 sm:grid-cols-2">
                {returnTo ? (
                  <Button asChild variant="outline" className="h-11 bg-card">
                    <a href={withLinkOutcome(returnTo, { error: "cancelled" })}>Not now</a>
                  </Button>
                ) : (
                  <Button asChild variant="outline" className="h-11 bg-card">
                    <a href="/">Not now</a>
                  </Button>
                )}
                <Button
                  type="button"
                  className="h-11"
                  disabled={busy !== null}
                  onClick={() => void link()}
                >
                  {busy === "link" ? (
                    <LoaderCircle className="animate-spin" aria-hidden="true" />
                  ) : (
                    <Link2 aria-hidden="true" />
                  )}
                  Link {method.name}
                </Button>
              </div>

              <p className="text-center text-xs leading-5 text-muted-foreground">
                You'll confirm on {method.name}, then come back
                {appName ? (
                  <>
                    {" "}
                    to <span className="font-medium text-foreground">{appName}</span>
                  </>
                ) : (
                  " here"
                )}
                .
              </p>
            </CardContent>
          </Card>
        </LoginLayout>
      );
  }
}

const METHOD_PURPOSE: Record<LinkMethod, string> = {
  telegram:
    "PoliNetwork's bots recognise you on Telegram through this link, with the roles you hold here.",
  "pn-entra":
    "You'll be able to sign in with your association account too, and PoliNetwork services will see your membership.",
  google: "You'll be able to sign in with this Google account too.",
};

/** The result, when there is no application to take it back to, or it needs explaining first. */
function Outcome({
  data,
  back,
}: {
  data: Extract<LinkPageData, { status: "outcome" }>;
  back: (outcome: LinkOutcome) => ReactNode;
}) {
  const { request, outcome } = data;
  const method = LINK_METHODS[request.method];
  if ("linked" in outcome) {
    return (
      <Notice icon={<BadgeCheck />} title={`${method.name} linked`}>
        Your {method.name} account is now linked to your PoliNetwork account.
        <Actions>
          <AccountButton primary />
        </Actions>
      </Notice>
    );
  }
  const retry = (
    <Button asChild variant="outline" className="h-11 bg-card">
      <a href={linkPagePath(request)}>Try again</a>
    </Button>
  );
  switch (outcome.error) {
    case "account_in_use":
      return (
        <Notice
          icon={<UserRoundX />}
          title={`This ${method.name} account belongs to another PoliNetwork account`}
        >
          You've used it before with a different PoliNetwork account than the one you're signed in
          with now. To link it here, sign in with that other account and unlink it from there, then
          try again. If you can't, ask the IT team.
          <Actions>{back(outcome) ?? <AccountButton primary />}</Actions>
        </Notice>
      );
    case "cancelled":
      return (
        <Notice icon={<MethodMark method={request.method} />} title="Nothing was linked">
          You cancelled on {method.name}. Try again when you're ready.
          <Actions>
            {retry}
            <AccountButton primary />
          </Actions>
        </Notice>
      );
    default:
      return (
        <Notice icon={<TriangleAlert />} title={`${method.name} wasn't linked`}>
          Something went wrong while linking your {method.name} account. Try again, and if it keeps
          happening, ask the IT team.
          <Actions>
            {retry}
            <AccountButton primary />
          </Actions>
        </Notice>
      );
  }
}

function MethodMark({ method }: { method: LinkMethod }) {
  return (
    <img
      src={`/brands/${LINK_METHODS[method].mark}.svg`}
      alt=""
      width={56}
      height={56}
      draggable={false}
      className="mx-auto size-14"
    />
  );
}

/** A centred card with one message and what to do next, which goes in `Actions`. */
function Notice({
  icon,
  title,
  children,
}: {
  icon: ReactNode;
  title: string;
  children: ReactNode;
}) {
  return (
    <LoginLayout wide>
      <Card>
        <CardContent className="flex flex-col items-center gap-4 px-6 py-10 text-center">
          <div className="flex size-14 items-center justify-center text-muted-foreground [&>svg]:size-6">
            {icon}
          </div>
          <h1 className="text-xl font-bold tracking-tight text-balance">{title}</h1>
          <div className="text-sm leading-6 text-muted-foreground">{children}</div>
        </CardContent>
      </Card>
    </LoginLayout>
  );
}

function Actions({ children }: { children: ReactNode }) {
  return <div className="mt-6 grid gap-3">{children}</div>;
}

function BackButton({ href, app }: { href: string; app: string }) {
  return (
    <Button asChild className="h-11">
      <a href={href}>Back to {app}</a>
    </Button>
  );
}

function AccountButton({ primary = false }: { primary?: boolean }) {
  return (
    <Button asChild variant={primary ? "default" : "outline"} className="h-11">
      <a href="/">Your account</a>
    </Button>
  );
}
