import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import type { ManagedPermissionKey } from "@/auth/rbac";
import type { OidcAdminPolicy } from "@/auth/oidc-admin";

export type IdpAccessStatus = "idle" | "loading" | "ready" | "error";

export type IdpAccess = {
  status: IdpAccessStatus;
  policy: OidcAdminPolicy | null;
  permissions: string[];
  /** Whether the signed-in person holds a managed permission. False until loaded. */
  can: (permission: ManagedPermissionKey) => boolean;
  retry: () => void;
};

type AccessResponse = { permissions: string[]; policy: OidcAdminPolicy };

/** What the signed-in person may do to the identity provider, as decided by the server. */
export function useIdpAccess(enabled: boolean): IdpAccess {
  const [status, setStatus] = useState<IdpAccessStatus>("idle");
  const [policy, setPolicy] = useState<OidcAdminPolicy | null>(null);
  const [permissions, setPermissions] = useState<string[]>([]);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    if (!enabled) {
      setStatus("idle");
      setPolicy(null);
      setPermissions([]);
      return;
    }
    const controller = new AbortController();
    setStatus("loading");
    fetch("/api/idp/access", { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Unable to check your access.");
        const access: AccessResponse = await response.json();
        setPolicy(access.policy);
        setPermissions(access.permissions);
        setStatus("ready");
      })
      .catch(() => {
        if (!controller.signal.aborted) setStatus("error");
      });
    return () => controller.abort();
  }, [enabled, revision]);

  return {
    status,
    policy,
    permissions,
    can: useCallback(
      (permission: ManagedPermissionKey) => permissions.includes(permission),
      [permissions],
    ),
    retry: useCallback(() => setRevision((value) => value + 1), []),
  };
}

const IdpAccessContext = createContext<IdpAccess | null>(null);

/** Shares one access check with every page inside an administration section. */
export function IdpAccessProvider({
  access,
  children,
}: {
  access: IdpAccess;
  children: ReactNode;
}) {
  return <IdpAccessContext.Provider value={access}>{children}</IdpAccessContext.Provider>;
}

export function useIdpAccessContext(): IdpAccess {
  const access = useContext(IdpAccessContext);
  if (!access) throw new Error("useIdpAccessContext must be used inside an IdpAccessProvider");
  return access;
}
