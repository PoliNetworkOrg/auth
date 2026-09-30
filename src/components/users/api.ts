import {
  type UserDetail,
  type UserListPage,
  type UserSearch,
  userSearchParams,
} from "@/auth/users";
import { readJson } from "@/components/rbac/api";

export function fetchUsers(search: UserSearch, signal?: AbortSignal) {
  return fetch(`/api/users?${userSearchParams(search)}`, { signal }).then((response) =>
    readJson<UserListPage>(response, "Unable to load users."),
  );
}

export function fetchUser(userId: string, signal?: AbortSignal) {
  return fetch(`/api/users/${encodeURIComponent(userId)}`, { signal }).then((response) =>
    readJson<UserDetail>(response, "Unable to load this person."),
  );
}

/** Permanent. `confirm` must repeat the person's name exactly. */
export function deleteUser(userId: string, confirm: string) {
  return fetch(`/api/users/${encodeURIComponent(userId)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "delete", confirm }),
  }).then((response) => readJson<{ deleted: true }>(response, "Unable to delete this person."));
}
