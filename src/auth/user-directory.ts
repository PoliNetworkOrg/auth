import { type SQL, and, asc, count, desc, eq, exists, inArray, not, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { account, identityEvidence, passkey, role, user, userRole } from "../db/schema";
import { contactEmails } from "./contact-email";
import { logAuthorizationDenial } from "./denial-log";
import { groupListings, traitConditions, searchCondition } from "./people-search";
import { readIdentitySubject, refreshIdentityMembership } from "./identity-subject";
import { resolveAccess } from "./rbac";
import { RbacError, assignedRoleKeys, withAuthorizedRbacRead } from "./rbac-store";
import {
  type UserDetail,
  type UserListPage,
  type UserSearch,
  USER_PAGE_SIZE,
  USER_TRAITS,
} from "./users";

const TELEGRAM_ISSUER = "https://oauth.telegram.org";
const POLIMI_EMAIL_ISSUER = "https://mail.polimi.it";

function requireRoleRead(actorId: string, permissions: readonly string[]) {
  if (permissions.includes("idp:roles:read")) return;
  logAuthorizationDenial(actorId, "user-directory", ["idp:roles:read"]);
  throw new RbacError(403, "Filtering by role needs permission to see roles.");
}

/**
 * The people registered here, a page at a time, with what an administrator checks at a
 * glance. Who holds a role is role data, so roles are only reported, or filtered by, for
 * someone who may read roles.
 */
export async function listUsers(actorId: string, search: UserSearch): Promise<UserListPage> {
  const groups = await groupListings();
  return withAuthorizedRbacRead(
    actorId,
    ["idp:users:read"],
    async (transaction, catalog, access) => {
      const canReadRoles = access.permissions.includes("idp:roles:read");
      const traits = traitConditions(transaction, groups, new Date());
      const filters: (SQL | undefined)[] = USER_TRAITS.map((trait) =>
        search[trait.key] === "yes"
          ? traits[trait.key]
          : search[trait.key] === "no"
            ? not(traits[trait.key])
            : undefined,
      );
      if (search.q)
        filters.push(searchCondition(transaction, search.q, catalog, traits, canReadRoles));
      if (search.role) {
        requireRoleRead(actorId, access.permissions);
        // Only roles given by hand have holders to list; built-in ones have their own filters.
        const target = catalog.roles.find((entry) => entry.key === search.role && !entry.managed);
        filters.push(
          target
            ? exists(
                transaction
                  .select({ found: sql`1` })
                  .from(userRole)
                  .where(and(eq(userRole.userId, user.id), eq(userRole.roleId, target.id))),
              )
            : sql`false`,
        );
      }
      const where = and(...filters);
      const page = search.page ?? 1;
      const pageSize = search.pageSize ?? USER_PAGE_SIZE;

      const [{ total }] = await transaction.select({ total: count() }).from(user).where(where);
      const rows = await transaction
        .select({
          id: user.id,
          name: user.name,
          email: user.email,
          image: user.image,
          createdAt: user.createdAt,
          socio: sql<boolean>`${traits.socio}`,
          direttivo: sql<boolean>`${traits.direttivo}`,
          student: sql<boolean>`${traits.student}`,
          telegram: sql<boolean>`${traits.telegram}`,
          google: sql<boolean>`${traits.google}`,
          polinetwork: sql<boolean>`${traits.polinetwork}`,
          passkey: sql<boolean>`${traits.passkey}`,
        })
        .from(user)
        .where(where)
        .orderBy(
          ...(search.sort === "newest"
            ? [desc(user.createdAt)]
            : search.sort === "oldest"
              ? [asc(user.createdAt)]
              : [asc(user.name)]),
          asc(user.id),
        )
        .limit(pageSize)
        .offset((page - 1) * pageSize);

      const ids = rows.map((row) => row.id);
      const linked = ids.length
        ? await transaction
            .select({
              userId: account.userId,
              providerId: account.providerId,
              accountId: account.accountId,
              telegramId: identityEvidence.telegramId,
              telegramUsername: identityEvidence.telegramUsername,
            })
            .from(account)
            .leftJoin(
              identityEvidence,
              and(
                eq(account.issuer, identityEvidence.issuer),
                eq(account.accountId, identityEvidence.subject),
                eq(account.providerId, identityEvidence.providerId),
              ),
            )
            .where(
              and(
                inArray(account.userId, ids),
                or(
                  and(eq(account.providerId, "telegram"), eq(account.issuer, TELEGRAM_ISSUER)),
                  and(
                    eq(account.providerId, "polimi-email"),
                    eq(account.issuer, POLIMI_EMAIL_ISSUER),
                  ),
                ),
              ),
            )
        : [];
      const assigned =
        canReadRoles && ids.length
          ? await transaction
              .select({ userId: userRole.userId, key: role.key })
              .from(userRole)
              .innerJoin(role, eq(role.id, userRole.roleId))
              .where(inArray(userRole.userId, ids))
              .orderBy(role.key)
          : [];

      const emails = await contactEmails(transaction, rows);

      return {
        users: rows.map((row) => {
          const telegram = linked.find(
            (entry) => entry.userId === row.id && entry.providerId === "telegram",
          );
          const polimi = linked.find(
            (entry) => entry.userId === row.id && entry.providerId === "polimi-email",
          );
          return {
            id: row.id,
            name: row.name,
            email: emails.get(row.id) ?? null,
            image: row.image,
            createdAt: row.createdAt.toISOString(),
            traits: {
              socio: row.socio,
              direttivo: row.direttivo,
              student: row.student,
              telegram: row.telegram,
              google: row.google,
              polinetwork: row.polinetwork,
              passkey: row.passkey,
            },
            telegramId: telegram?.telegramId ?? null,
            telegramUsername: telegram?.telegramUsername ?? null,
            polimiEmail: polimi?.accountId ?? null,
            roles: canReadRoles
              ? assigned.filter((entry) => entry.userId === row.id).map((entry) => entry.key)
              : null,
          };
        }),
        total,
        page,
        pageSize,
        membership: { socio: groups.socio.source, direttivo: groups.direttivo.source },
      };
    },
  );
}

const assigner = alias(user, "assigner");

/**
 * Everything the directory knows about one person. Their identity states are checked
 * the same way their next token would be, including a fresh group check, so this page is
 * where to confirm what the list could only summarize.
 */
export async function getUserDetail(actorId: string, userId: string): Promise<UserDetail> {
  // Group checks finish before the read transaction starts. Someone unknown fails here and
  // is reported as not found once the actor has been authorized.
  await refreshIdentityMembership(userId).catch(() => undefined);
  return withAuthorizedRbacRead(
    actorId,
    ["idp:users:read"],
    async (transaction, catalog, access) => {
      const [person] = await transaction
        .select({
          id: user.id,
          name: user.name,
          email: user.email,
          image: user.image,
          createdAt: user.createdAt,
          updatedAt: user.updatedAt,
        })
        .from(user)
        .where(eq(user.id, userId));
      if (!person) throw new RbacError(404, "That person was not found.");

      const accounts = await transaction
        .select({
          id: account.id,
          providerId: account.providerId,
          issuer: account.issuer,
          accountId: account.accountId,
          createdAt: account.createdAt,
          validUntil: identityEvidence.validUntil,
          telegramId: identityEvidence.telegramId,
          telegramUsername: identityEvidence.telegramUsername,
        })
        .from(account)
        .leftJoin(
          identityEvidence,
          and(
            eq(account.issuer, identityEvidence.issuer),
            eq(account.accountId, identityEvidence.subject),
            eq(account.providerId, identityEvidence.providerId),
          ),
        )
        .where(eq(account.userId, userId))
        .orderBy(account.createdAt);
      const [{ passkeys }] = await transaction
        .select({ passkeys: count() })
        .from(passkey)
        .where(eq(passkey.userId, userId));
      const subject = await readIdentitySubject(userId, transaction);
      const emails = await contactEmails(transaction, [person]);

      const canReadRoles = access.permissions.includes("idp:roles:read");
      const canReadPermissions =
        canReadRoles || access.permissions.includes("idp:permissions:read");
      const assignedRoles = canReadRoles
        ? await transaction
            .select({
              key: role.key,
              name: role.name,
              assignedAt: userRole.assignedAt,
              assignedBy: userRole.assignedBy,
              assignedByName: assigner.name,
            })
            .from(userRole)
            .innerJoin(role, eq(role.id, userRole.roleId))
            .leftJoin(assigner, eq(assigner.id, userRole.assignedBy))
            .where(eq(userRole.userId, userId))
            .orderBy(role.key)
        : null;
      const resolved = canReadPermissions
        ? resolveAccess(catalog, [
            ...(await assignedRoleKeys(userId, catalog, transaction)),
            ...subject.roleKeys,
          ])
        : null;

      return {
        id: person.id,
        name: person.name,
        email: emails.get(person.id) ?? null,
        image: person.image,
        createdAt: person.createdAt.toISOString(),
        updatedAt: person.updatedAt.toISOString(),
        accounts: accounts.map((entry) => {
          const polimi =
            entry.providerId === "polimi-email" && entry.issuer === POLIMI_EMAIL_ISSUER;
          const telegram = entry.providerId === "telegram" && entry.issuer === TELEGRAM_ISSUER;
          return {
            id: entry.id,
            providerId: entry.providerId,
            identifier: telegram ? entry.telegramId : polimi ? entry.accountId : null,
            username: telegram ? entry.telegramUsername : null,
            linkedAt: entry.createdAt.toISOString(),
            validUntil: polimi && entry.validUntil ? entry.validUntil.toISOString() : null,
          };
        }),
        passkeys,
        telegramId: subject.telegramId,
        states: subject.states,
        assignedRoles:
          assignedRoles?.map((entry) => ({
            key: entry.key,
            name: entry.name,
            assignedAt: entry.assignedAt?.toISOString() ?? null,
            assignedBy: entry.assignedBy
              ? { id: entry.assignedBy, name: entry.assignedByName }
              : null,
          })) ?? null,
        roles: canReadRoles ? (resolved?.roles ?? []) : null,
        permissions: resolved?.permissions ?? null,
      };
    },
  );
}
