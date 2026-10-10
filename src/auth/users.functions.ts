import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { validate } from "@/lib/validate";
import { permissionMiddleware } from "./middleware";
import { deleteUser } from "./user-deletion";
import { getUserDetail, listUsers } from "./user-directory";
import { userSearchSchema } from "./users";

/** One page of the user directory, filtered the way the page URL says. */
export const getUsers = createServerFn({ method: "GET" })
  .middleware([permissionMiddleware("idp:users:read")])
  .validator(validate(userSearchSchema))
  .handler(({ context, data }) => listUsers(context.session.userId, data));

/** One person, with their status checked live. */
export const getUser = createServerFn({ method: "GET" })
  .middleware([permissionMiddleware("idp:users:read")])
  .validator(validate(z.object({ userId: z.string().min(1) })))
  .handler(({ context, data }) => getUserDetail(context.session.userId, data.userId));

/**
 * Permanently deletes someone. `confirm` must repeat their name exactly; `deleteUser` checks
 * it, and refuses deleting yourself, configured administrators, and Master Admins.
 */
export const deleteUserFn = createServerFn({ method: "POST" })
  .middleware([permissionMiddleware("idp:users:delete")])
  .validator(validate(z.object({ userId: z.string().min(1), confirm: z.string().max(200) })))
  .handler(async ({ context, data }) => {
    await deleteUser(context.session.userId, data.userId, data.confirm);
  });
