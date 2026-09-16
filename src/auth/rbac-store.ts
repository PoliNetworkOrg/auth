import { randomUUID } from "node:crypto";
import { and, count, desc, eq, ilike, or, sql } from "drizzle-orm";
import { db } from "../db/index";
import {
  permission,
  permissionImplication,
  role,
  roleParent,
  rolePermission,
  user,
  userRole,
} from "../db/schema";
import {
  type PermissionDraft,
  type PermissionSummary,
  type RbacCatalog,
  type ResolvedAccess,
  type RoleDraft,
  type RoleMember,
  type RoleSummary,
  type UserSearchResult,
  MANAGED_PERMISSIONS,
  MASTER_ADMIN_ROLE_KEY,
  hasDraftErrors,
  normalizePermissionDraft,
  normalizeRoleDraft,
  resolveAccess,
  STATIC_ROLES,
  staticRolesForStates,
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

/** Managed rows keep a derived, stable id so the seed is idempotent across replicas. */
function staticRoleId(key: string) {
  return `static-role-${key}`;
}

function managedPermissionId(key: string) {
  return `managed-permission-${key.replace(/:/g, "-")}`;
}

let managedRecordsReady: Promise<void> | undefined;

/**
 * Makes sure the roles and permissions the identity provider defines itself exist. The
 * checked-in migrations seed them; this is the safety net for a database restored from an
 * older dump. Existing rows are left alone so administrator edits to their name,
 * description, and the roles that carry them survive a restart.
 */
export function ensureManagedRecords(): Promise<void> {
  managedRecordsReady ??= db
    .transaction(async (transaction) => {
      await transaction
        .insert(role)
        .values(
          STATIC_ROLES.map((entry) => ({
            id: staticRoleId(entry.key),
            key: entry.key,
            name: entry.name,
            description: entry.description,
            managed: true,
            sourceState: entry.state,
          })),
        )
        .onConflictDoNothing({ target: role.key });
      await transaction
        .insert(permission)
        .values(
          MANAGED_PERMISSIONS.map((entry) => ({
            id: managedPermissionId(entry.key),
            key: entry.key,
            name: entry.name,
            description: entry.description,
            managed: true,
          })),
        )
        .onConflictDoNothing({ target: permission.key });
      const implications = MANAGED_PERMISSIONS.flatMap((entry) =>
        entry.implies.map((implied) => ({
          permissionId: managedPermissionId(entry.key),
          impliedPermissionId: managedPermissionId(implied),
        })),
      );
      if (implications.length)
        await transaction.insert(permissionImplication).values(implications).onConflictDoNothing();
    })
    .then(() => undefined)
    .catch((cause: unknown) => {
      managedRecordsReady = undefined;
      throw cause;
    });
  return managedRecordsReady;
}

const CATALOG_TTL_MS = 15_000;
let cached: { readAt: number; catalog: RbacCatalog } | undefined;

/**
 * Drops the memoized catalog. Every writer calls this so an administrator always sees the
 * result of their own change; other replicas catch up within `CATALOG_TTL_MS`.
 */
export function invalidateCatalog() {
  cached = undefined;
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

export async function loadCatalog(): Promise<RbacCatalog> {
  if (cached && Date.now() - cached.readAt < CATALOG_TTL_MS) return cached.catalog;
  await ensureManagedRecords();
  const catalog = await readCatalog(db);
  cached = { readAt: Date.now(), catalog };
  return catalog;
}

// Follows the convention the migration bootstrap uses for its own lock.
const hierarchyLock = sql`select pg_advisory_xact_lock(hashtext('polinetwork-auth'), hashtext('rbac-hierarchy'))`;

/**
 * Runs a change to the role or permission graph against the graph as it actually is.
 *
 * Both hierarchies are validated by walking the whole catalog, so validating against the
 * memoized copy would let two administrators writing at the same time each add an edge
 * that is fine on its own while the pair closes a cycle. The transaction-scoped advisory
 * lock serializes these writes across every replica, and the catalog is then re-read
 * inside the transaction so the checks see the other writer's committed work.
 */
async function withRbacWriteLock<T>(
  change: (transaction: Transaction, catalog: RbacCatalog) => Promise<T>,
): Promise<T> {
  await ensureManagedRecords();
  return db.transaction(async (transaction) => {
    await transaction.execute(hierarchyLock);
    return change(transaction, await readCatalog(transaction));
  });
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
  input: PermissionDraft,
  permissionId?: string,
): Promise<PermissionSummary> {
  const draft = normalizePermissionDraft(input);
  const id = await withRbacWriteLock(async (transaction, catalog) => {
    const current = permissionId ? requirePermission(catalog, permissionId) : undefined;
    // A managed permission's key is what the identity provider's own checks look for.
    if (current?.managed && draft.key !== current.key)
      throw new RbacError(400, "The key of a built-in permission cannot be changed.", {
        key: "This permission is defined by the identity provider.",
      });
    checked(validatePermissionDraft(draft, { catalog, currentKey: current?.key }));
    const id = current?.id ?? randomUUID();
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
    return id;
  });
  invalidateCatalog();
  const saved = (await loadCatalog()).permissions.find((entry) => entry.id === id);
  if (!saved) throw new RbacError(500, "The permission could not be read back.");
  return saved;
}

export async function deletePermission(permissionId: string) {
  await withRbacWriteLock(async (transaction, catalog) => {
    const current = requirePermission(catalog, permissionId);
    if (current.managed)
      throw new RbacError(
        400,
        "Permissions defined by the identity provider cannot be deleted. Remove it from the roles that carry it instead.",
      );
    await transaction.delete(permission).where(eq(permission.id, permissionId));
  });
  invalidateCatalog();
}

export async function saveRole(input: RoleDraft, roleId?: string): Promise<RoleSummary> {
  const draft = normalizeRoleDraft(input);
  const id = await withRbacWriteLock(async (transaction, catalog) => {
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
    const id = current?.id ?? randomUUID();
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
    return id;
  });
  invalidateCatalog();
  const saved = (await loadCatalog()).roles.find((entry) => entry.id === id);
  if (!saved) throw new RbacError(500, "The role could not be read back.");
  return saved;
}

export async function deleteRole(roleId: string) {
  await withRbacWriteLock(async (transaction, catalog) => {
    const current = requireRole(catalog, roleId);
    if (current.managed)
      throw new RbacError(400, "Roles defined by the identity provider cannot be deleted.");
    await transaction.delete(role).where(eq(role.id, roleId));
  });
  invalidateCatalog();
}

export async function listRoleMembers(roleId: string): Promise<RoleMember[]> {
  const catalog = await loadCatalog();
  requireRole(catalog, roleId);
  const rows = await db
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
    .where(eq(userRole.roleId, roleId))
    .orderBy(desc(userRole.assignedAt));
  return rows.map((row) => ({ ...row, assignedAt: row.assignedAt?.toISOString() ?? null }));
}

export async function assignRole(roleId: string, userId: string, assignedBy: string) {
  const catalog = await loadCatalog();
  const target = requireRole(catalog, roleId);
  // Membership of a managed role follows the evidence, never an administrator's decision.
  if (target.managed)
    throw new RbacError(
      400,
      `${target.name} is granted automatically and cannot be assigned by hand.`,
    );
  const [found] = await db.select({ id: user.id }).from(user).where(eq(user.id, userId)).limit(1);
  if (!found) throw new RbacError(404, "That person was not found.");
  await db.insert(userRole).values({ roleId, userId, assignedBy }).onConflictDoNothing();
  invalidateCatalog();
}

export async function unassignRole(roleId: string, userId: string) {
  await db.delete(userRole).where(and(eq(userRole.roleId, roleId), eq(userRole.userId, userId)));
  invalidateCatalog();
}

/** People an administrator can pick when assigning a role. */
export async function searchUsers(query: string): Promise<UserSearchResult[]> {
  const term = `%${query.trim().replace(/[%_\\]/g, (match) => `\\${match}`)}%`;
  return db
    .select({ id: user.id, name: user.name, email: user.email, image: user.image })
    .from(user)
    .where(query.trim() ? or(ilike(user.name, term), ilike(user.email, term)) : undefined)
    .orderBy(user.name)
    .limit(25);
}

/** The role keys a person has been given by hand, ignoring anything managed. */
export async function assignedRoleKeys(userId: string, catalog: RbacCatalog): Promise<string[]> {
  const rows = await db
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

/**
 * The roles and permissions a person currently holds: the roles assigned to them, the
 * managed roles their identity states prove, and any role conferred some other way (Master
 * Admin comes from the configured allowlist, not from evidence), expanded through both
 * hierarchies.
 */
export async function resolveUserAccess(
  userId: string,
  states: readonly string[],
  conferredRoleKeys: readonly string[] = [],
): Promise<ResolvedAccess> {
  const catalog = await loadCatalog();
  const held = [
    ...(await assignedRoleKeys(userId, catalog)),
    ...staticRolesForStates(states),
    ...conferredRoleKeys,
  ];
  return resolveAccess(catalog, held);
}
