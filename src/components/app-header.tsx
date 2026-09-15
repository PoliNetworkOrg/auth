import { Link } from "@tanstack/react-router";
import { cn } from "cn";
import { authClient } from "@/auth/client";
import { type OidcAccessState, useOidcAccess } from "@/components/oidc/use-oidc-access";
import { ThemeSwitch } from "@/components/theme-switch";
import { UserAvatar } from "@/components/user-avatar";

type Section = "account" | "applications" | "access";

export function AppHeader({ active, access }: { active: Section; access?: OidcAccessState }) {
  const { data: session } = authClient.useSession();
  const ownAccess = useOidcAccess(!!session && !access);
  const status = (access ?? ownAccess).status;
  const links: { to: "/" | "/applications" | "/access/roles"; label: string; section: Section }[] =
    [{ to: "/", label: "Account", section: "account" }];
  if (status === "allowed") {
    links.push({ to: "/applications", label: "Applications", section: "applications" });
    links.push({ to: "/access/roles", label: "Access", section: "access" });
  }
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
            aria-label="PoliNetwork Identity home"
          >
            <img src="/polinetwork-logo.svg" width={40} height={40} alt="" className="size-10" />
            <span className="font-bold tracking-tight">
              PoliNetwork <span className="ml-1 font-normal text-muted-foreground">Identity</span>
            </span>
          </Link>
          {nav("hidden items-center gap-1 sm:flex")}
        </div>
        <div className="flex items-center gap-3">
          <ThemeSwitch />
          {session && (
            <div className="size-9 overflow-hidden rounded-full border bg-muted text-xs font-semibold text-muted-foreground">
              <UserAvatar name={session.user.name} image={session.user.image} />
            </div>
          )}
        </div>
      </div>
      {nav("flex gap-1 overflow-x-auto px-5 pb-3 sm:hidden")}
    </header>
  );
}
