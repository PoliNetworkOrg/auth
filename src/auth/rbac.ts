// Shared by the server and the browser: keep this file free of server-only imports.

/**
 * Roles the identity provider always defines itself. They exist without being created,
 * cannot be deleted or assigned by hand, and are granted by the evidence the rest of the
 * IdP already collects: `state` is the identity state that confers the role.
 *
 * Administrators can still rename them, describe them, give them permissions, and place
 * them in the role hierarchy — only their membership is out of their hands.
 */
export const STATIC_ROLES = [
  {
    key: "socio",
    state: "socio",
    name: "Socio",
    description: "Member of PoliNetwork APS.",
    evidence: "Direct membership of the Soci group in PoliNetwork Entra ID, rechecked on sign-in.",
  },
  {
    key: "direttivo",
    state: "direttivo",
    name: "Direttivo",
    description: "Member of the PoliNetwork APS board.",
    evidence:
      "Direct membership of the Direttivo group in PoliNetwork Entra ID, rechecked on sign-in.",
  },
  {
    key: "student",
    state: "student",
    name: "Student",
    description: "Verified Politecnico di Milano student.",
    evidence: "A verification code delivered to the person's @mail.polimi.it address.",
  },
] as const;

export type StaticRole = (typeof STATIC_ROLES)[number];
export type StaticRoleKey = StaticRole["key"];

export const STATIC_ROLE_KEYS: string[] = STATIC_ROLES.map((entry) => entry.key);

export function isStaticRoleKey(key: string) {
  return STATIC_ROLE_KEYS.includes(key);
}

export function staticRole(key: string): StaticRole | undefined {
  return STATIC_ROLES.find((entry) => entry.key === key);
}

/** The managed roles proven by a set of identity states, in catalog order. */
export function staticRolesForStates(states: readonly string[]): string[] {
  return STATIC_ROLES.filter((entry) => states.includes(entry.state)).map((entry) => entry.key);
}

export type PermissionSummary = {
  id: string;
  key: string;
  name: string;
  description: string | null;
  /** Keys of the permissions this one also grants. */
  implies: string[];
  roleCount: number;
  createdAt: string | null;
  updatedAt: string | null;
};

export type RoleSummary = {
  id: string;
  key: string;
  name: string;
  description: string | null;
  /** Managed roles are inferred from identity evidence and never assigned by hand. */
  managed: boolean;
  sourceState: string | null;
  /** Keys of the permissions granted directly, before inheritance. */
  permissions: string[];
  /** Keys of the roles this role inherits permissions from. */
  parents: string[];
  /** People holding a hand-made assignment. Always 0 for managed roles. */
  memberCount: number;
  createdAt: string | null;
  updatedAt: string | null;
};

export type RbacCatalog = { roles: RoleSummary[]; permissions: PermissionSummary[] };

export const emptyCatalog: RbacCatalog = { roles: [], permissions: [] };

type CatalogIndex = {
  roles: Map<string, RoleSummary>;
  permissions: Map<string, PermissionSummary>;
};

function indexCatalog(catalog: RbacCatalog): CatalogIndex {
  return {
    roles: new Map(catalog.roles.map((entry) => [entry.key, entry])),
    permissions: new Map(catalog.permissions.map((entry) => [entry.key, entry])),
  };
}

/**
 * Walks a hierarchy from the given keys, following `edges` breadth-first. The visited set
 * makes traversal terminate even if stored data ever contains a cycle, so a bad edge
 * cannot hang token issuance.
 */
function closure(start: Iterable<string>, edges: (key: string) => readonly string[]): Set<string> {
  const seen = new Set<string>();
  const queue = [...start];
  while (queue.length) {
    const key = queue.shift() as string;
    if (seen.has(key)) continue;
    seen.add(key);
    for (const next of edges(key)) if (!seen.has(next)) queue.push(next);
  }
  return seen;
}

/** The given roles plus every role they inherit from, transitively. */
export function expandRoleKeys(catalog: RbacCatalog, roleKeys: Iterable<string>): string[] {
  const index = indexCatalog(catalog);
  const reachable = closure(roleKeys, (key) => index.roles.get(key)?.parents ?? []);
  return [...reachable].filter((key) => index.roles.has(key)).sort();
}

/** The given permissions plus every permission they grant, transitively. */
export function expandPermissionKeys(
  catalog: RbacCatalog,
  permissionKeys: Iterable<string>,
): string[] {
  const index = indexCatalog(catalog);
  const reachable = closure(permissionKeys, (key) => index.permissions.get(key)?.implies ?? []);
  return [...reachable].filter((key) => index.permissions.has(key)).sort();
}

export type ResolvedAccess = { roles: string[]; permissions: string[] };

/**
 * Turns the roles a person holds into the access they actually have: roles expand up the
 * role hierarchy, then the permissions those roles carry expand down the permission
 * hierarchy. Keys that no longer exist in the catalog are dropped.
 */
export function resolveAccess(catalog: RbacCatalog, roleKeys: Iterable<string>): ResolvedAccess {
  const index = indexCatalog(catalog);
  const roles = expandRoleKeys(catalog, roleKeys);
  const granted = roles.flatMap((key) => index.roles.get(key)?.permissions ?? []);
  return { roles, permissions: expandPermissionKeys(catalog, granted) };
}

/** Everything a single role confers, for explaining inheritance in the admin UI. */
export function effectiveRolePermissions(catalog: RbacCatalog, roleKey: string): string[] {
  return resolveAccess(catalog, [roleKey]).permissions;
}

/**
 * Whether pointing `from` at `to` would close a loop in a hierarchy. Used before writing a
 * role parent or a permission implication so stored edges stay acyclic.
 */
export function wouldCycle(
  edges: (key: string) => readonly string[],
  from: string,
  to: string,
): boolean {
  return from === to || closure([to], edges).has(from);
}

export function roleParentWouldCycle(catalog: RbacCatalog, roleKey: string, parentKey: string) {
  const index = indexCatalog(catalog);
  return wouldCycle((key) => index.roles.get(key)?.parents ?? [], roleKey, parentKey);
}

export function permissionImplicationWouldCycle(
  catalog: RbacCatalog,
  permissionKey: string,
  impliedKey: string,
) {
  const index = indexCatalog(catalog);
  return wouldCycle((key) => index.permissions.get(key)?.implies ?? [], permissionKey, impliedKey);
}

export const MAX_KEY_LENGTH = 64;
export const MAX_NAME_LENGTH = 80;
export const MAX_DESCRIPTION_LENGTH = 300;

/** Permission keys read like `membership:read`; role keys like `group-moderator`. */
const PERMISSION_KEY_PATTERN = /^[a-z0-9]([a-z0-9._:-]*[a-z0-9])?$/;
const ROLE_KEY_PATTERN = /^[a-z0-9]([a-z0-9._-]*[a-z0-9])?$/;

export type PermissionDraft = {
  key: string;
  name: string;
  description: string;
  implies: string[];
};

export type RoleDraft = {
  key: string;
  name: string;
  description: string;
  parents: string[];
  permissions: string[];
};

export type RbacDraftErrors = {
  key?: string;
  name?: string;
  description?: string;
  implies?: string;
  parents?: string;
  permissions?: string;
};

export function emptyPermissionDraft(): PermissionDraft {
  return { key: "", name: "", description: "", implies: [] };
}

export function emptyRoleDraft(): RoleDraft {
  return { key: "", name: "", description: "", parents: [], permissions: [] };
}

export function permissionDraftFrom(permission: PermissionSummary): PermissionDraft {
  return {
    key: permission.key,
    name: permission.name,
    description: permission.description ?? "",
    implies: [...permission.implies],
  };
}

export function roleDraftFrom(role: RoleSummary): RoleDraft {
  return {
    key: role.key,
    name: role.name,
    description: role.description ?? "",
    parents: [...role.parents],
    permissions: [...role.permissions],
  };
}

export function normalizePermissionDraft(draft: PermissionDraft): PermissionDraft {
  return {
    key: draft.key.trim().toLowerCase(),
    name: draft.name.trim(),
    description: draft.description.trim(),
    implies: [...new Set(draft.implies)].sort(),
  };
}

export function normalizeRoleDraft(draft: RoleDraft): RoleDraft {
  return {
    key: draft.key.trim().toLowerCase(),
    name: draft.name.trim(),
    description: draft.description.trim(),
    parents: [...new Set(draft.parents)].sort(),
    permissions: [...new Set(draft.permissions)].sort(),
  };
}

function validateShared(
  draft: { key: string; name: string; description: string },
  pattern: RegExp,
  taken: (key: string) => boolean,
  hint: string,
): RbacDraftErrors {
  const errors: RbacDraftErrors = {};
  const key = draft.key.trim().toLowerCase();
  if (!key) errors.key = "Give it a key.";
  else if (key.length > MAX_KEY_LENGTH)
    errors.key = `Keep the key under ${MAX_KEY_LENGTH} characters.`;
  else if (!pattern.test(key)) errors.key = hint;
  else if (taken(key)) errors.key = "This key is already used.";

  const name = draft.name.trim();
  if (!name) errors.name = "Give it a name.";
  else if (name.length > MAX_NAME_LENGTH)
    errors.name = `Keep the name under ${MAX_NAME_LENGTH} characters.`;

  if (draft.description.trim().length > MAX_DESCRIPTION_LENGTH)
    errors.description = `Keep the description under ${MAX_DESCRIPTION_LENGTH} characters.`;
  return errors;
}

export type DraftContext = {
  catalog: RbacCatalog;
  /** The key being edited, so an unchanged key is not reported as taken. */
  currentKey?: string;
};

export function validatePermissionDraft(
  draft: PermissionDraft,
  { catalog, currentKey }: DraftContext,
): RbacDraftErrors {
  const index = indexCatalog(catalog);
  const errors = validateShared(
    draft,
    PERMISSION_KEY_PATTERN,
    (key) => key !== currentKey && index.permissions.has(key),
    "Use lowercase letters, digits, and . _ - : for example membership:read.",
  );
  const key = draft.key.trim().toLowerCase();
  if (draft.implies.some((implied) => !index.permissions.has(implied)))
    errors.implies = "One of the granted permissions no longer exists.";
  else if (draft.implies.includes(key)) errors.implies = "A permission cannot grant itself.";
  else if (
    currentKey &&
    draft.implies.some((implied) => permissionImplicationWouldCycle(catalog, currentKey, implied))
  )
    errors.implies = "That would make two permissions grant each other.";
  return errors;
}

export function validateRoleDraft(
  draft: RoleDraft,
  { catalog, currentKey }: DraftContext,
): RbacDraftErrors {
  const index = indexCatalog(catalog);
  const errors = validateShared(
    draft,
    ROLE_KEY_PATTERN,
    (key) => key !== currentKey && index.roles.has(key),
    "Use lowercase letters, digits, and . _ - for example group-moderator.",
  );
  const key = draft.key.trim().toLowerCase();
  if (!currentKey && isStaticRoleKey(key))
    errors.key = "This key belongs to a role the identity provider defines itself.";
  if (draft.permissions.some((permission) => !index.permissions.has(permission)))
    errors.permissions = "One of the selected permissions no longer exists.";
  if (draft.parents.some((parent) => !index.roles.has(parent)))
    errors.parents = "One of the selected roles no longer exists.";
  else if (draft.parents.includes(key)) errors.parents = "A role cannot inherit from itself.";
  else if (
    currentKey &&
    draft.parents.some((parent) => roleParentWouldCycle(catalog, currentKey, parent))
  )
    errors.parents = "That would make two roles inherit from each other.";
  return errors;
}

export function hasDraftErrors(errors: RbacDraftErrors) {
  return Object.keys(errors).length > 0;
}

export type RoleMember = {
  userId: string;
  name: string;
  email: string;
  image: string | null;
  assignedAt: string | null;
  assignedBy: string | null;
};

export type UserSearchResult = { id: string; name: string; email: string; image: string | null };
