import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { validate } from "@/lib/validate";
import { permissionMiddleware } from "./middleware";
import {
  assignRole,
  deletePermission,
  deleteRole,
  listRoleMembers,
  loadCatalog,
  savePermission,
  saveRole,
  searchUsers,
  unassignRole,
} from "./rbac-store";

/** The whole role and permission graph; every eRBACo page needs it to show relationships. */
export const getCatalog = createServerFn({ method: "GET" })
  .middleware([permissionMiddleware("idp:permissions:read", "idp:roles:read")])
  .handler(({ context }) => loadCatalog(context.session.userId));

const roleDraftSchema = z.object({
  key: z.string(),
  name: z.string(),
  description: z.string(),
  parents: z.array(z.string()).max(50),
  permissions: z.array(z.string()).max(200),
});

/** Creates a role, or changes one when `roleId` is given. */
export const saveRoleFn = createServerFn({ method: "POST" })
  .middleware([permissionMiddleware("idp:roles:write")])
  .validator(validate(z.object({ roleId: z.string().min(1).optional(), draft: roleDraftSchema })))
  .handler(({ context, data }) => saveRole(context.session.userId, data.draft, data.roleId));

export const deleteRoleFn = createServerFn({ method: "POST" })
  .middleware([permissionMiddleware("idp:roles:write")])
  .validator(validate(z.object({ roleId: z.string().min(1) })))
  .handler(async ({ context, data }) => {
    await deleteRole(context.session.userId, data.roleId);
  });

const permissionDraftSchema = z.object({
  key: z.string(),
  name: z.string(),
  description: z.string(),
  implies: z.array(z.string()).max(50),
});

/** Creates a permission, or changes one when `permissionId` is given. */
export const savePermissionFn = createServerFn({ method: "POST" })
  .middleware([permissionMiddleware("idp:permissions:write")])
  .validator(
    validate(
      z.object({ permissionId: z.string().min(1).optional(), draft: permissionDraftSchema }),
    ),
  )
  .handler(({ context, data }) =>
    savePermission(context.session.userId, data.draft, data.permissionId),
  );

export const deletePermissionFn = createServerFn({ method: "POST" })
  .middleware([permissionMiddleware("idp:permissions:write")])
  .validator(validate(z.object({ permissionId: z.string().min(1) })))
  .handler(async ({ context, data }) => {
    await deletePermission(context.session.userId, data.permissionId);
  });

/** One page of the people holding a role, after the `after` cursor. */
export const getRoleMembers = createServerFn({ method: "GET" })
  .middleware([permissionMiddleware("idp:roles:read")])
  .validator(validate(z.object({ roleId: z.string().min(1), after: z.string().optional() })))
  .handler(({ context, data }) => listRoleMembers(context.session.userId, data.roleId, data.after));

/**
 * Gives a role to someone or takes it away. A successful self-revocation may remove read
 * access; the write is still acknowledged, and later reads authorize on their own.
 */
export const changeRoleMemberFn = createServerFn({ method: "POST" })
  .middleware([permissionMiddleware("idp:roles:assign")])
  .validator(
    validate(
      z.object({
        action: z.enum(["assign", "unassign"]),
        roleId: z.string().min(1),
        userId: z.string().min(1),
      }),
    ),
  )
  .handler(async ({ context, data }) => {
    if (data.action === "assign")
      await assignRole(context.session.userId, data.roleId, data.userId);
    else await unassignRole(context.session.userId, data.roleId, data.userId);
  });

/** People matching a search. Scoped to a role, each result says whether they hold it. */
export const searchPeople = createServerFn({ method: "GET" })
  .middleware([permissionMiddleware("idp:people:read")])
  .validator(validate(z.object({ query: z.string(), roleId: z.string().optional() })))
  .handler(({ context, data }) => searchUsers(context.session.userId, data.query, data.roleId));
