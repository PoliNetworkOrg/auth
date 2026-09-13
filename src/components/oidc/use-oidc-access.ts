import { useEffect, useState } from "react";
import type { OidcAdminPolicy } from "@/auth/oidc-admin";
import { fetchOidcAccess } from "./api";

export type OidcAccessStatus = "idle" | "loading" | "allowed" | "denied" | "error";

export type OidcAccessState = {
  status: OidcAccessStatus;
  policy: OidcAdminPolicy | null;
  retry: () => void;
};

/** Whether the signed-in user may manage OIDC applications, as decided by the server. */
export function useOidcAccess(enabled: boolean): OidcAccessState {
  const [status, setStatus] = useState<OidcAccessStatus>("idle");
  const [policy, setPolicy] = useState<OidcAdminPolicy | null>(null);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!enabled) {
      setStatus("idle");
      setPolicy(null);
      return;
    }
    const controller = new AbortController();
    setStatus("loading");
    fetchOidcAccess(controller.signal)
      .then((access) => {
        setPolicy(access.policy);
        setStatus(access.allowed ? "allowed" : "denied");
      })
      .catch(() => {
        if (!controller.signal.aborted) setStatus("error");
      });
    return () => controller.abort();
  }, [enabled, revision]);
  return { status, policy, retry: () => setRevision((value) => value + 1) };
}
