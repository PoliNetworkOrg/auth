import { searchPeople } from "@/auth/rbac.functions";

/**
 * Whether someone still holds a role after their direct assignment was removed, asked of the
 * server again rather than read from the member list shown before: another administrator may
 * have removed the role that passed it on meanwhile. Someone who can no longer search is told
 * nothing more, so the person is shown as no longer holding it.
 */
export async function holdsRoleAfterUnassign(roleId: string, userId: string) {
  try {
    const found = await searchPeople({ data: { query: userId, roleId } });
    return found.some((person) => person.id === userId && person.holdsRole);
  } catch {
    return false;
  }
}
