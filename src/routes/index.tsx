import { createFileRoute } from "@tanstack/react-router";
import { LogOut } from "lucide-react";
import { getAccount, type AccountDetails } from "@/auth/account.functions";
import type { Viewer } from "@/auth/session.functions";
import { AccountCards } from "@/components/account/account-cards";
import { GroupsPanel, PasskeysPanel, PermissionsPanel } from "@/components/account/access-panels";
import { DebugPanel } from "@/components/account/debug-panel";
import { McpPanel } from "@/components/account/mcp-panel";
import { Spinner } from "@/components/account/panel";
import { SessionsPanel } from "@/components/account/sessions-panel";
import { useAccountActions } from "@/components/account/use-account-actions";
import { useProviders, useViewer } from "@/components/access";
import { AppHeader } from "@/components/app-header";
import { LoginPage } from "@/components/login-page";
import { UserAvatar } from "@/components/user-avatar";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/")({
  // `/` is also the OIDC sign-in page: it reads the signed OAuth query as it is, so it has
  // no search validation that could drop or rewrite those parameters.
  loader: ({ context }) => (context.viewer ? getAccount() : null),
  component: Home,
});

function Home() {
  const viewer = useViewer();
  const details = Route.useLoaderData();
  if (!viewer || !details) return <LoginPage />;
  return <AccountPage key={viewer.user.id} viewer={viewer} details={details} />;
}

function AccountPage({ viewer, details }: { viewer: Viewer; details: AccountDetails }) {
  const providers = useProviders();
  const actions = useAccountActions();
  return (
    <div className="flex-1">
      <AppHeader active="account" />
      <main className="mx-auto grid max-w-6xl grid-cols-[minmax(0,1fr)] gap-10 px-5 py-8 sm:px-8 sm:py-12">
        <header className="flex items-start gap-4 sm:items-center sm:gap-5">
          <div className="size-12 shrink-0 overflow-hidden rounded-full bg-primary text-xl font-semibold text-primary-foreground ring-1 ring-black/10 ring-inset sm:size-16 dark:ring-white/10">
            <UserAvatar name={viewer.user.name} image={viewer.user.image} />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-bold tracking-tight text-balance break-words sm:text-3xl">
              {viewer.user.name}
            </h1>
            {details.primaryEmail && (
              <p className="mt-1 truncate text-sm text-muted-foreground">{details.primaryEmail}</p>
            )}
          </div>
          <Button
            variant="destructive-soft"
            className="h-10"
            disabled={actions.busy !== null}
            onClick={() => void actions.signOut()}
          >
            {actions.busy === "sign-out" ? <Spinner /> : <LogOut />}
            Sign out
          </Button>
        </header>

        <AccountCards details={details} providers={providers} actions={actions} />

        <div className="grid gap-10">
          <PasskeysPanel passkeys={details.passkeys} actions={actions} />
          <SessionsPanel sessions={details.sessions} actions={actions} />
          <GroupsPanel groups={details.groups} />
          <PermissionsPanel permissions={details.permissions} />
          {details.mcp && <McpPanel mcp={details.mcp} actions={actions} />}
          <DebugPanel debug={details.debug} />
        </div>
      </main>
    </div>
  );
}
