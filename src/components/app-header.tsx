import { Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { cn } from "cn";
import { LogOut, UserRound } from "lucide-react";
import { Popover } from "radix-ui";
import { authClient } from "@/auth/client";
import { type IdpAccess, useIdpAccess } from "@/components/idp-access";
import { firstAccessTab } from "@/components/rbac/access-tabs";
import { ThemeSwitch } from "@/components/theme-switch";
import { Button } from "@/components/ui/button";
import { UserAvatar } from "@/components/user-avatar";

type Section = "account" | "users" | "applications" | "access";

export function AppHeader({ active, access }: { active: Section; access?: IdpAccess }) {
  const { data: session } = authClient.useSession();
  const ownAccess = useIdpAccess(!!session && !access);
  const { can } = access ?? ownAccess;
  const links: {
    to:
      | "/"
      | "/users"
      | "/applications"
      | "/applications/new"
      | "/access/roles"
      | "/access/permissions";
    label: string;
    section: Section;
  }[] = [{ to: "/", label: "Account", section: "account" }];
  if (can("idp:users:read")) links.push({ to: "/users", label: "Users", section: "users" });
  const canReadApplications = can("idp:applications:read");
  // Someone who may register applications without seeing the existing ones goes straight
  // to the form, rather than to a list they would be refused.
  if (canReadApplications || can("idp:applications:write"))
    links.push({
      to: canReadApplications ? "/applications" : "/applications/new",
      label: "Applications",
      section: "applications",
    });
  // Straight to the tab they can actually read, rather than a page that would refuse them.
  const accessTab = firstAccessTab(can);
  if (accessTab) links.push({ to: accessTab.to, label: "eRBACo", section: "access" });
  const nav = (className: string) =>
    session && links.length > 1 ? (
      <nav aria-label="Primary" className={className}>
        {links.map((link) => (
          <Link
            key={link.to}
            to={link.to}
            aria-current={link.section === active ? "page" : undefined}
            className={cn(
              "rounded-full px-3.5 py-1.5 text-sm font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring",
              link.section === active
                ? "bg-secondary text-secondary-foreground"
                : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
            )}
          >
            {link.label}
          </Link>
        ))}
      </nav>
    ) : null;
  return (
    <header className="border-b bg-card">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-4 sm:px-8">
        <div className="flex items-center gap-6">
          <Link
            to="/"
            className="flex items-center gap-3 rounded-md text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="PoliNetwork Auth home"
          >
            <img src="/polinetwork-logo.svg" width={40} height={40} alt="" className="size-10" />
            <span className="font-bold tracking-tight">
              PoliNetwork <span className="ml-1 font-normal text-muted-foreground">Auth</span>
            </span>
          </Link>
          {nav("hidden items-center gap-1 sm:flex")}
        </div>
        <div className="flex items-center gap-3">
          <ThemeSwitch />
          {session && <AccountMenu user={session.user} />}
        </div>
      </div>
      {nav("flex gap-1 overflow-x-auto px-5 pb-3 sm:hidden")}
    </header>
  );
}

function AccountMenu({ user }: { user: { name: string; email: string; image?: string | null } }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setError(null);
      }}
    >
      <Popover.Trigger
        aria-label="Open account menu"
        className="size-9 overflow-hidden rounded-full border bg-muted text-xs font-semibold text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <UserAvatar name={user.name} image={user.image} />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={8}
          className="z-50 w-64 rounded-2xl border bg-card p-4 text-card-foreground shadow-lg duration-200 outline-none data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
        >
          <div className="flex items-center gap-3">
            <div className="size-11 shrink-0 overflow-hidden rounded-full border bg-muted text-sm font-semibold text-muted-foreground">
              <UserAvatar name={user.name} image={user.image} />
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{user.name}</p>
              <p className="truncate text-xs text-muted-foreground">{user.email}</p>
            </div>
          </div>
          <div className="mt-4 grid gap-1 border-t pt-3">
            <Button asChild variant="ghost" size="sm" className="justify-start">
              <Link to="/" onClick={() => setOpen(false)}>
                <UserRound />
                Your account
              </Link>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="justify-start text-muted-foreground"
              onClick={async () => {
                const result = await authClient.signOut();
                if (result.error) {
                  setError(result.error.message ?? "Unable to sign out.");
                  return;
                }
                setOpen(false);
                void navigate({ to: "/" });
              }}
            >
              <LogOut />
              Sign out
            </Button>
          </div>
          {error && (
            <p role="alert" className="mt-2 text-xs text-destructive">
              {error}
            </p>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
