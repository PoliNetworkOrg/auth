import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useIdpAccessContext } from "@/components/idp-access";
import { firstAccessTab } from "@/components/rbac/access-tabs";

export const Route = createFileRoute("/access/")({ component: AccessIndex });

/**
 * The section has no landing page of its own, so it opens the first tab the person may
 * read. Which one that is depends on their permissions, which are only known once the
 * surrounding layout has checked them, so this redirects on render rather than in
 * `beforeLoad`.
 */
function AccessIndex() {
  const { can } = useIdpAccessContext();
  const tab = firstAccessTab(can);
  if (!tab) return null;
  return <Navigate to={tab.to} replace />;
}
