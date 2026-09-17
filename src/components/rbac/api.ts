import type {
  PermissionDraft,
  PermissionSummary,
  RbacCatalog,
  RbacDraftErrors,
  RoleDraft,
  RoleMemberPage,
  RoleSummary,
  UserSearchResult,
} from "@/auth/rbac";

export class RbacApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly fields?: RbacDraftErrors,
  ) {
    super(message);
  }
}

async function readJson<T>(response: Response, fallback: string): Promise<T> {
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const details =
      body && typeof body === "object"
        ? (body as { error?: string; fields?: RbacDraftErrors })
        : {};
    throw new RbacApiError(details.error ?? fallback, response.status, details.fields);
  }
  return body as T;
}

function post<T>(path: string, body: unknown, fallback: string) {
  return fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then((response) => readJson<T>(response, fallback));
}

export function fetchCatalog(signal?: AbortSignal) {
  return fetch("/api/rbac/catalog", { signal }).then((response) =>
    readJson<RbacCatalog>(response, "Unable to load roles and permissions."),
  );
}

export function savePermission(draft: PermissionDraft, permissionId?: string) {
  return post<PermissionSummary>(
    "/api/rbac/permission-save",
    permissionId ? { action: "update", permissionId, draft } : { action: "create", draft },
    "Unable to save the permission.",
  );
}

export function deletePermission(permissionId: string) {
  return post<{ deleted: true }>(
    "/api/rbac/permission-save",
    { action: "delete", permissionId },
    "Unable to delete the permission.",
  );
}

export function saveRole(draft: RoleDraft, roleId?: string) {
  return post<RoleSummary>(
    "/api/rbac/role-save",
    roleId ? { action: "update", roleId, draft } : { action: "create", draft },
    "Unable to save the role.",
  );
}

export function deleteRole(roleId: string) {
  return post<{ deleted: true }>(
    "/api/rbac/role-save",
    { action: "delete", roleId },
    "Unable to delete the role.",
  );
}

export function fetchRoleMembers(roleId: string, signal?: AbortSignal, after?: string) {
  const params = new URLSearchParams({ role_id: roleId });
  if (after) params.set("after", after);
  return fetch(`/api/rbac/role-members?${params}`, { signal }).then((response) =>
    readJson<RoleMemberPage>(response, "Unable to load the people in this role."),
  );
}

export function changeRoleMember(action: "assign" | "unassign", roleId: string, userId: string) {
  return post<{ changed: true }>(
    "/api/rbac/role-members",
    { action, roleId, userId },
    "Unable to change who holds this role.",
  );
}

export function searchUsers(query: string, signal?: AbortSignal) {
  return fetch(`/api/rbac/users?q=${encodeURIComponent(query)}`, { signal }).then((response) =>
    readJson<UserSearchResult[]>(response, "Unable to search people."),
  );
}

export function errorMessage(cause: unknown, fallback: string) {
  return cause instanceof Error && cause.message ? cause.message : fallback;
}
