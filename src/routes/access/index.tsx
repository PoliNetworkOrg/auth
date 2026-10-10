import { createFileRoute, redirect } from "@tanstack/react-router";
import { accessOf } from "@/components/access";
import { firstAccessTab } from "@/components/rbac/access-tabs";

/**
 * The section has no landing page of its own, so it opens the first tab the person may
 * read. The layout's guard has already refused anyone with no tab at all.
 */
export const Route = createFileRoute("/access/")({
  beforeLoad: ({ context }) => {
    const tab = firstAccessTab(accessOf(context.viewer).can);
    if (tab) throw redirect({ to: tab.to, replace: true });
  },
});
