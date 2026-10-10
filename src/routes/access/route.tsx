import {
  type ErrorComponentProps,
  createFileRoute,
  Link,
  Outlet,
  useRouterState,
} from "@tanstack/react-router";
import { cn } from "cn";
import { requireAccess, useAccess } from "@/components/access";
import { ACCESS_TABS } from "@/components/rbac/access-tabs";
import { NoAccess, SectionShell, SectionError } from "@/components/route-error";

export const Route = createFileRoute("/access")({
  head: () => ({ meta: [{ title: "eRBACo · PoliNetwork Auth" }] }),
  // Whatever any tab needs, rather than one fixed permission: the implication that makes
  // reading roles grant reading permissions is stored data an administrator can remove.
  beforeLoad: ({ context }) =>
    requireAccess(context.viewer, ...ACCESS_TABS.map((tab) => tab.permission)),
  component: AccessLayout,
  errorComponent: AccessError,
});

function AccessLayout() {
  const { can } = useAccess();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const visibleTabs = ACCESS_TABS.filter((tab) => can(tab.permission));

  return (
    <SectionShell active="access">
      <div className="space-y-8">
        <div className="space-y-6">
          <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">eRBACo</h1>
          <nav aria-label="eRBACo administration" className="flex gap-1 border-b">
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
        </div>
        <Outlet />
      </div>
    </SectionShell>
  );
}

function AccessError({ error }: ErrorComponentProps) {
  return (
    <SectionError
      error={error}
      active="access"
      noAccess={
        <NoAccess title="Roles are managed by PoliNetwork staff">
          Access requires role or permission administration access. Ask an administrator to grant
          the appropriate role.
        </NoAccess>
      }
    />
  );
}
