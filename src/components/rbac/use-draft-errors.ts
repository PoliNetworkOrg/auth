import { useEffect, useState } from "react";
import type { RbacDraftErrors } from "@/auth/rbac";

/**
 * Keeps the field errors a save was rejected with visible.
 *
 * The browser revalidates the draft as it is edited, but it validates against the catalog
 * it loaded, so the server can still refuse a save the form thought was fine: a key taken
 * in the meantime, or an edge that would close a cycle someone else just created. Those
 * rejections stay on their field until that field is edited again, instead of disappearing
 * behind the browser's own verdict.
 */
export function useDraftErrors(serverErrors: RbacDraftErrors | undefined) {
  const [edited, setEdited] = useState<string[]>([]);
  useEffect(() => setEdited([]), [serverErrors]);
  const unresolved = Object.fromEntries(
    Object.entries(serverErrors ?? {}).filter(([field]) => !edited.includes(field)),
  ) as RbacDraftErrors;
  return {
    serverFieldErrors: unresolved,
    noteEdited: (fields: string[]) => setEdited((previous) => [...previous, ...fields]),
  };
}
