import { mayDelegateMutation } from "./rbac-delegation";
import { logAuthorizationDenial } from "./denial-log";
import { readIdentitySubject, refreshIdentityMembership } from "./identity-subject";
import type { IdentityClaims } from "./policy";
import { randomUUID } from "node:crypto";
import { and, count, eq, gt, ilike, or } from "drizzle-orm";
import { db } from "../db/index";
import { authorizationMutationLock } from "../db/security-lock";
import {
  rbacAuditEvent,
  permission,
  permissionImplication,
  role,
  roleParent,
  rolePermission,
  user,
  userRole,
} from "../db/schema";
import {
  type ManagedPermissionKey,
  type ResolvedAccess,
  type PermissionDraft,
  type PermissionSummary,
  type RbacCatalog,
  type RoleDraft,
  type RoleMemberPage,
  type RoleSummary,
  type UserSearchResult,
  MASTER_ADMIN_ROLE_KEY,
  hasDraftErrors,
  catalogForIdpPermissions,
  normalizePermissionDraft,
  normalizeRoleDraft,
  resolveAccess,
  validatePermissionDraft,
  validateRoleDraft,
} from "./rbac";

export class RbacError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly fields?: Record<string, string>,
  ) {
    super(message);
  }
}

/** Anything that can run the catalog queries: the pool, or an open transaction. */
type CatalogReader = Pick<typeof db, "select">;

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

// Read one query at a time: `db` may be an open transaction, and a transaction is a single
// PostgreSQL session that cannot run overlapping queries.
async function readCatalog(db: CatalogReader): Promise<RbacCatalog> {
  const roles = await db.select().from(role).orderBy(role.key);
  const permissions = await db.select().from(permission).orderBy(permission.key);
  const rolePermissions = await db
    .select({ roleId: rolePermission.roleId, permissionKey: permission.key })
    .from(rolePermission)
    .innerJoin(permission, eq(permission.id, rolePermission.permissionId));
  const roleParents = await db
    .select({ roleId: roleParent.roleId, parentKey: role.key })
    .from(roleParent)
    .innerJoin(role, eq(role.id, roleParent.parentRoleId));
  const implications = await db
    .select({ permissionId: permissionImplication.permissionId, impliedKey: permission.key })
    .from(permissionImplication)
    .innerJoin(permission, eq(permission.id, permissionImplication.impliedPermissionId));
  const members = await db
    .select({ roleId: userRole.roleId, members: count() })
    .from(userRole)
    .groupBy(userRole.roleId);

  const collect = <T>(rows: T[], keyOf: (row: T) => string, valueOf: (row: T) => string) => {
    const grouped = new Map<string, string[]>();
    for (const row of rows) {
      const list = grouped.get(keyOf(row));
      if (list) list.push(valueOf(row));
      else grouped.set(keyOf(row), [valueOf(row)]);
    }
    for (const list of grouped.values()) list.sort();
    return grouped;
  };

  const permissionsByRole = collect(
    rolePermissions,
    (row) => row.roleId,
    (row) => row.permissionKey,
  );
  const parentsByRole = collect(
    roleParents,
    (row) => row.roleId,
    (row) => row.parentKey,
  );
  const impliedByPermission = collect(
    implications,
    (row) => row.permissionId,
    (row) => row.impliedKey,
  );
  const memberCounts = new Map(members.map((row) => [row.roleId, row.members]));
  const rolesPerPermission = new Map<string, number>();
  for (const row of rolePermissions)
    rolesPerPermission.set(row.permissionKey, (rolesPerPermission.get(row.permissionKey) ?? 0) + 1);

  return {
    roles: roles.map((row): RoleSummary => ({
      id: row.id,
      key: row.key,
      name: row.name,
      description: row.description,
      managed: row.managed,
      sourceState: row.sourceState,
      permissions: permissionsByRole.get(row.id) ?? [],
      parents: parentsByRole.get(row.id) ?? [],
      memberCount: memberCounts.get(row.id) ?? 0,
      createdAt: row.createdAt?.toISOString() ?? null,
      updatedAt: row.updatedAt?.toISOString() ?? null,
    })),
    permissions: permissions.map((row): PermissionSummary => ({
      id: row.id,
      key: row.key,
      name: row.name,
      description: row.description,
      managed: row.managed,
      implies: impliedByPermission.get(row.id) ?? [],
      roleCount: rolesPerPermission.get(row.key) ?? 0,
      createdAt: row.createdAt?.toISOString() ?? null,
      updatedAt: row.updatedAt?.toISOString() ?? null,
    })),
  };
}

/** Read guards and protected data share one database snapshot. */
export async function withAuthorizedRbacRead<T>(
  actorId: string,
  required: readonly ManagedPermissionKey[],
  read: (transaction: Transaction, catalog: RbacCatalog, access: ResolvedAccess) => Promise<T>,
): Promise<T> {
  await refreshIdentityMembership(actorId);
  return db.transaction(
    async (transaction) => {
      const subject = await readIdentitySubject(actorId, transaction);
      const catalog = await readCatalog(transaction);
      const access = resolveAccess(catalog, [
        ...(await assignedRoleKeys(actorId, catalog, transaction)),
        ...subject.roleKeys,
      ]);
      if (!required.some((key) => access.permissions.includes(key))) {
        logAuthorizationDenial(actorId, "rbac-store", required);
        throw new RbacError(403, "You do not have permission to do that.");
      }
      return read(transaction, catalog, access);
    },
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
}

export async function loadCatalog(actorId: string): Promise<RbacCatalog> {
  return withAuthorizedRbacRead(
    actorId,
    ["idp:roles:read", "idp:permissions:read"],
    async (_transaction, catalog, access) => catalogForIdpPermissions(catalog, access.permissions),
  );
}

/**
 * Runs a change to the role or permission graph against the graph as it actually is.
 *
 * Both hierarchies are validated by walking the whole catalog, so validating against the
 * memoized copy would let two administrators writing at the same time each add an edge
 * that is fine on its own while the pair closes a cycle. The transaction-scoped advisory
 * lock serializes these writes across every replica, and the catalog is then re-read
 * inside the transaction so the checks see the other writer's committed work.
 */
export async function withAuthorizedRbacWrite<T>(
  actorId: string,
  required: Extract<ManagedPermissionKey, `${string}:write`>,
  change: (transaction: Transaction, catalog: RbacCatalog, access: ResolvedAccess) => Promise<T>,
): Promise<T> {
  await refreshIdentityMembership(actorId);
  return db.transaction(
    async (transaction) => {
      await transaction.execute(authorizationMutationLock);
      const subject = await readIdentitySubject(actorId, transaction);
      const catalog = await readCatalog(transaction);
      const access = resolveAccess(catalog, [
        ...(await assignedRoleKeys(actorId, catalog, transaction)),
        ...subject.roleKeys,
      ]);
      if (!access.permissions.includes(required)) {
        logAuthorizationDenial(actorId, "rbac-store", [required]);
        throw new RbacError(403, "You do not have permission to do that.");
      }
      return change(transaction, catalog, access);
    },
    { isolationLevel: "read committed" },
  );
}

async function auditSnapshot(
  transaction: Transaction,
  catalog: RbacCatalog,
  operation: string,
  targetId: string,
) {
  if (operation.startsWith("permission.")) {
    const target = catalog.permissions.find((entry) => entry.id === targetId);
    return {
      target: target ?? null,
      roles: catalog.roles
        .filter((entry) => target && entry.permissions.includes(target.key))
        .map((entry) => ({ id: entry.id, permissions: entry.permissions })),
      incoming: catalog.permissions
        .filter((entry) => target && entry.implies.includes(target.key))
        .map((entry) => ({ id: entry.id, implies: entry.implies })),
    };
  }
  const target = catalog.roles.find((entry) => entry.id === targetId);
  return {
    target: target ?? null,
    children: catalog.roles
      .filter((entry) => target && entry.parents.includes(target.key))
      .map((entry) => ({ id: entry.id, parents: entry.parents })),
    assignments: await transaction.select().from(userRole).where(eq(userRole.roleId, targetId)),
  };
}

async function withRbacWriteLock<T>(
  actorId: string,
  operation: string,
  targetId: string,
  change: (transaction: Transaction, catalog: RbacCatalog, access: ResolvedAccess) => Promise<T>,
): Promise<T> {
  return withAuthorizedRbacWrite(
    actorId,
    operation.startsWith("permission.") ? "idp:permissions:write" : "idp:roles:write",
    async (transaction, catalog, access) => {
      const before = await auditSnapshot(transaction, catalog, operation, targetId);
      const result = await change(transaction, catalog, access);
      const next = await readCatalog(transaction);
      if (!mayDelegateMutation(catalog, next, access, operation, targetId)) {
        logAuthorizationDenial(actorId, "rbac-store", ["bounded-delegation"]);
        throw new RbacError(
          403,
          "This change exceeds your delegated authority. Ask a Master Admin.",
        );
      }
      const after = await auditSnapshot(transaction, next, operation, targetId);
      await transaction
        .insert(rbacAuditEvent)
        .values({ id: randomUUID(), actorId, operation, targetId, before, after });
      return result;
    },
  );
}

function requireRole(catalog: RbacCatalog, roleId: string) {
  const found = catalog.roles.find((entry) => entry.id === roleId);
  if (!found) throw new RbacError(404, "Role not found.");
  return found;
}

function requirePermission(catalog: RbacCatalog, permissionId: string) {
  const found = catalog.permissions.find((entry) => entry.id === permissionId);
  if (!found) throw new RbacError(404, "Permission not found.");
  return found;
}

function idsForPermissionKeys(catalog: RbacCatalog, keys: string[]) {
  return keys.map((key) => {
    const found = catalog.permissions.find((entry) => entry.key === key);
    if (!found) throw new RbacError(400, `Unknown permission ${key}.`);
    return found.id;
  });
}

function idsForRoleKeys(catalog: RbacCatalog, keys: string[]) {
  return keys.map((key) => {
    const found = catalog.roles.find((entry) => entry.key === key);
    if (!found) throw new RbacError(400, `Unknown role ${key}.`);
    return found.id;
  });
}

function checked(errors: Record<string, string | undefined>) {
  if (hasDraftErrors(errors))
    throw new RbacError(400, "Check the highlighted fields.", errors as Record<string, string>);
}

export async function savePermission(
  actorId: string,
  input: PermissionDraft,
  permissionId?: string,
): Promise<PermissionSummary> {
  const draft = normalizePermissionDraft(input);
  const targetId = permissionId ?? randomUUID();
  return withRbacWriteLock(actorId, "permission.save", targetId, async (transaction, catalog) => {
    const current = permissionId ? requirePermission(catalog, permissionId) : undefined;
    // A managed permission's key is what the identity provider's own checks look for.
    if (current?.managed && draft.key !== current.key)
      throw new RbacError(400, "The key of a built-in permission cannot be changed.", {
        key: "This permission is defined by the identity provider.",
      });
    checked(validatePermissionDraft(draft, { catalog, currentKey: current?.key }));
    const id = targetId;
    const impliedIds = idsForPermissionKeys(catalog, draft.implies);
    const values = {
      key: draft.key,
      name: draft.name,
      description: draft.description || null,
      updatedAt: new Date(),
    };
    if (current) await transaction.update(permission).set(values).where(eq(permission.id, id));
    else await transaction.insert(permission).values({ id, ...values });
    await transaction
      .delete(permissionImplication)
      .where(eq(permissionImplication.permissionId, id));
    if (impliedIds.length)
      await transaction
        .insert(permissionImplication)
        .values(
          impliedIds.map((impliedPermissionId) => ({ permissionId: id, impliedPermissionId })),
        );
    return (await readCatalog(transaction)).permissions.find((entry) => entry.id === id)!;
  });
}

export async function deletePermission(actorId: string, permissionId: string) {
  await withRbacWriteLock(
    actorId,
    "permission.delete",
    permissionId,
    async (transaction, catalog) => {
      const current = requirePermission(catalog, permissionId);
      if (current.managed)
        throw new RbacError(
          400,
          "Permissions defined by the identity provider cannot be deleted. Remove it from the roles that carry it instead.",
        );
      await transaction.delete(permission).where(eq(permission.id, permissionId));
    },
  );
}

export async function saveRole(
  actorId: string,
  input: RoleDraft,
  roleId?: string,
): Promise<RoleSummary> {
  const draft = normalizeRoleDraft(input);
  const targetId = roleId ?? randomUUID();
  return withRbacWriteLock(actorId, "role.save", targetId, async (transaction, catalog) => {
    const current = roleId ? requireRole(catalog, roleId) : undefined;
    // A managed role's key is what ties it to the evidence that grants it.
    if (current?.managed && draft.key !== current.key)
      throw new RbacError(400, "The key of a built-in role cannot be changed.", {
        key: "This role is defined by the identity provider.",
      });
    // Master Admin already holds everything, so a stored grant list would only mislead.
    if (
      current?.key === MASTER_ADMIN_ROLE_KEY &&
      (draft.permissions.length > 0 || draft.parents.length > 0)
    )
      throw new RbacError(
        400,
        `${current.name} already holds every permission, so it needs no grants of its own.`,
      );
    checked(validateRoleDraft(draft, { catalog, currentKey: current?.key }));
    const id = targetId;
    const permissionIds = idsForPermissionKeys(catalog, draft.permissions);
    const parentIds = idsForRoleKeys(catalog, draft.parents);
    const values = {
      key: draft.key,
      name: draft.name,
      description: draft.description || null,
      updatedAt: new Date(),
    };
    if (current) await transaction.update(role).set(values).where(eq(role.id, id));
    else await transaction.insert(role).values({ id, managed: false, ...values });
    await transaction.delete(rolePermission).where(eq(rolePermission.roleId, id));
    if (permissionIds.length)
      await transaction
        .insert(rolePermission)
        .values(permissionIds.map((permissionId) => ({ roleId: id, permissionId })));
    await transaction.delete(roleParent).where(eq(roleParent.roleId, id));
    if (parentIds.length)
      await transaction
        .insert(roleParent)
        .values(parentIds.map((parentRoleId) => ({ roleId: id, parentRoleId })));
    return (await readCatalog(transaction)).roles.find((entry) => entry.id === id)!;
  });
}

export async function deleteRole(actorId: string, roleId: string) {
  await withRbacWriteLock(actorId, "role.delete", roleId, async (transaction, catalog) => {
    const current = requireRole(catalog, roleId);
    if (current.managed)
      throw new RbacError(400, "Roles defined by the identity provider cannot be deleted.");
    await transaction.delete(role).where(eq(role.id, roleId));
  });
}

export async function listRoleMembers(
  actorId: string,
  roleId: string,
  after?: string,
): Promise<RoleMemberPage> {
  return withAuthorizedRbacRead(actorId, ["idp:roles:read"], async (transaction, catalog) => {
    requireRole(catalog, roleId);
    const rows = await transaction
      .select({
        userId: user.id,
        name: user.name,
        email: user.email,
        image: user.image,
        assignedAt: userRole.assignedAt,
        assignedBy: userRole.assignedBy,
      })
      .from(userRole)
      .innerJoin(user, eq(user.id, userRole.userId))
      .where(and(eq(userRole.roleId, roleId), after ? gt(user.id, after) : undefined))
      .orderBy(user.id)
      .limit(101);
    return {
      members: rows.slice(0, 100).map((row) => ({
        ...row,
        assignedAt: row.assignedAt?.toISOString() ?? null,
      })),
      nextCursor: rows.length > 100 ? rows[99]!.userId : null,
    };
  });
}

export async function assignRole(actorId: string, roleId: string, userId: string) {
  await withRbacWriteLock(actorId, "role.assign", roleId, async (transaction, catalog) => {
    const target = requireRole(catalog, roleId);
    if (target.managed) throw new RbacError(400, "Managed roles cannot be assigned by hand.");
    const [found] = await transaction.select({ id: user.id }).from(user).where(eq(user.id, userId));
    if (!found) throw new RbacError(404, "That person was not found.");
    await transaction
      .insert(userRole)
      .values({ roleId, userId, assignedBy: actorId })
      .onConflictDoNothing();
  });
}

export async function unassignRole(actorId: string, roleId: string, userId: string) {
  await withRbacWriteLock(actorId, "role.unassign", roleId, async (transaction, catalog) => {
    const target = requireRole(catalog, roleId);
    if (target.managed) throw new RbacError(400, "Managed roles cannot be revoked by hand.");
    await transaction
      .delete(userRole)
      .where(and(eq(userRole.roleId, roleId), eq(userRole.userId, userId)));
  });
}

/** People an administrator can pick when assigning a role. */
export async function searchUsers(actorId: string, query: string): Promise<UserSearchResult[]> {
  return withAuthorizedRbacRead(actorId, ["idp:people:read"], async (transaction) => {
    const term = `%${query.trim().replace(/[%_\\]/g, (match) => `\\${match}`)}%`;
    return transaction
      .select({ id: user.id, name: user.name, email: user.email, image: user.image })
      .from(user)
      .where(query.trim() ? or(ilike(user.name, term), ilike(user.email, term)) : undefined)
      .orderBy(user.name)
      .limit(25);
  });
}

/** The role keys a person has been given by hand, ignoring anything managed. */
async function assignedRoleKeys(
  userId: string,
  catalog: RbacCatalog,
  reader: CatalogReader,
): Promise<string[]> {
  const rows = await reader
    .select({ roleId: userRole.roleId })
    .from(userRole)
    .where(eq(userRole.userId, userId));
  const assignable = new Map(
    catalog.roles.filter((entry) => !entry.managed).map((entry) => [entry.id, entry.key]),
  );
  return rows.flatMap((row) => {
    const key = assignable.get(row.roleId);
    return key ? [key] : [];
  });
}

/** Read identity, assignments and graph from one committed database snapshot. */
export async function resolveUserIdentity(userId: string): Promise<IdentityClaims> {
  await refreshIdentityMembership(userId);
  return db.transaction(
    async (transaction) => {
      const subject = await readIdentitySubject(userId, transaction);
      const catalog = await readCatalog(transaction);
      const held = [...(await assignedRoleKeys(userId, catalog, transaction)), ...subject.roleKeys];
      const access = resolveAccess(catalog, held);
      return { states: subject.states, telegramId: subject.telegramId, ...access };
    },
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
}
