import { type ErrorComponentProps, createFileRoute, Outlet } from "@tanstack/react-router";
import { requireAccess } from "@/components/access";
import { NoAccess, SectionShell, SectionError } from "@/components/route-error";

export const Route = createFileRoute("/applications")({
  head: () => ({ meta: [{ title: "Applications · PoliNetwork Auth" }] }),
  beforeLoad: ({ context }) =>
    requireAccess(context.viewer, "idp:applications:read", "idp:applications:write"),
  component: ApplicationsLayout,
  errorComponent: ApplicationsError,
});

function ApplicationsLayout() {
  return (
    <SectionShell active="applications">
      <Outlet />
    </SectionShell>
  );
}

function ApplicationsError({ error }: ErrorComponentProps) {
  return (
    <SectionError
      error={error}
      active="applications"
      noAccess={
        <NoAccess title="Applications are managed by PoliNetwork staff">
          Access requires application permissions. Ask an administrator to grant the appropriate
          role.
        </NoAccess>
      }
    />
  );
}
