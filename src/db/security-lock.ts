import { sql } from "drizzle-orm";

/** All local mutations of authorization graphs, assignments and linked evidence serialize
 * on this transaction-scoped lock. Use READ COMMITTED and read only after acquiring it. */
export const authorizationMutationLock = sql`select pg_advisory_xact_lock(hashtext('polinetwork-auth'), hashtext('rbac-hierarchy'))`;
