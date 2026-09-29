import type { ManagedPermissionKey } from "@/auth/rbac";

/**
 * The Access section's tabs, in the order they are shown and fallen back to. Shared so the
 * navigation, the section layout, and the landing redirect cannot disagree about which
 * permission opens which page.
 */
export const ACCESS_TABS = [
  { to: "/access/roles", label: "Roles", permission: "idp:roles:read" },
  { to: "/access/permissions", label: "Permissions", permission: "idp:permissions:read" },
] as const satisfies readonly { to: string; label: string; permission: ManagedPermissionKey }[];

export type AccessTab = (typeof ACCESS_TABS)[number];

/** Where someone entering the section should land, or null when no tab is open to them. */
export function firstAccessTab(
  can: (permission: ManagedPermissionKey) => boolean,
): AccessTab | null {
  return ACCESS_TABS.find((tab) => can(tab.permission)) ?? null;
}
