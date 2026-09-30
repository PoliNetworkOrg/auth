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
