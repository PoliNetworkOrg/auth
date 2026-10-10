import { type ErrorComponentProps, createFileRoute, Outlet } from "@tanstack/react-router";
import { requireAccess } from "@/components/access";
import { NoAccess, SectionShell, SectionError } from "@/components/route-error";

const note =
  "Role changes apply to new sign-ins immediately. Already-issued tokens expire within minutes.";

export const Route = createFileRoute("/users")({
  head: () => ({ meta: [{ title: "Users · PoliNetwork Auth" }] }),
  beforeLoad: ({ context }) => requireAccess(context.viewer, "idp:users:read"),
  component: UsersLayout,
  errorComponent: UsersError,
});

function UsersLayout() {
  return (
    <SectionShell active="users" note={note}>
      <Outlet />
    </SectionShell>
  );
}

function UsersError({ error }: ErrorComponentProps) {
  return (
    <SectionError
      error={error}
      active="users"
      note={note}
      noAccess={
        <NoAccess title="The user directory is for PoliNetwork staff" permission="idp:users:read" />
      }
    />
  );
}
