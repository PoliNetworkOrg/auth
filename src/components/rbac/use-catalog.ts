import { useCallback, useEffect, useState } from "react";
import { type RbacCatalog, emptyCatalog } from "@/auth/rbac";
import { errorMessage, fetchCatalog } from "./api";

export type CatalogState = {
  catalog: RbacCatalog;
  loading: boolean;
  error: string;
  reload: () => void;
};

/** Loads the whole role and permission graph; every page needs it to show relationships. */
export function useCatalog(enabled = true): CatalogState {
  const [catalog, setCatalog] = useState<RbacCatalog>(emptyCatalog);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    setLoading(true);
    setError("");
    fetchCatalog(controller.signal)
      .then((value) => {
        setCatalog(value);
        setLoading(false);
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setError(errorMessage(cause, "Unable to load roles and permissions."));
        setLoading(false);
      });
    return () => controller.abort();
  }, [enabled, revision]);

  return { catalog, loading, error, reload: useCallback(() => setRevision((n) => n + 1), []) };
}
