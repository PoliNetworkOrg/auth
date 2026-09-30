import {
  type SQL,
  and,
  asc,
  count,
  desc,
  eq,
  exists,
  gt,
  ilike,
  inArray,
  not,
  or,
  sql,
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "../db/index";
import { account, identityEvidence, passkey, role, user, userRole } from "../db/schema";
import { env } from "../env";
import { contactEmails } from "./contact-email";
import { logAuthorizationDenial } from "./denial-log";
import { groupMembers } from "./group-listing";
import { readIdentitySubject, refreshIdentityMembership } from "./identity-subject";
import { resolveAccess } from "./rbac";
import { RbacError, assignedRoleKeys, withAuthorizedRbacRead } from "./rbac-store";
import {
  type GroupTrait,
  type MembershipSource,
  type UserDetail,
  type UserListPage,
  type UserSearch,
  type UserTrait,
  USER_PAGE_SIZE,
  USER_TRAITS,
} from "./users";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

// The same trust boundary `readIdentitySubject` applies: evidence counts only from the
// issuer each provider is expected to use.
const TELEGRAM_ISSUER = "https://oauth.telegram.org";
const POLIMI_EMAIL_ISSUER = "https://mail.polimi.it";

function entraIssuer() {
  return env.PN_ENTRA_TENANT_ID
    ? `https://login.microsoftonline.com/${env.PN_ENTRA_TENANT_ID}/v2.0`
    : undefined;
}

type GroupListing = { source: MembershipSource; members: Set<string> | null };

/**
 * Who is in each PoliNetwork group right now. Checking people one by one would page
 * through the group once per person, so the directory lists each group once instead. When
 * Graph cannot answer, it falls back to what each person's last PoliNetwork sign-in
 * recorded, and says so.
 */
async function groupListings(): Promise<Record<GroupTrait, GroupListing>> {
  const listing = async (groupId: string | undefined): Promise<GroupListing> => {
    if (!groupId || !entraIssuer()) return { source: "unconfigured", members: null };
    const members = await groupMembers(groupId);
    return members ? { source: "live", members } : { source: "recorded", members: null };
  };
  const [socio, direttivo] = await Promise.all([
    listing(env.PN_ENTRA_MEMBER_GROUP_ID),
    listing(env.PN_ENTRA_DIRETTIVO_GROUP_ID),
  ]);
  return { socio, direttivo };
}

/** Whether the person owns an account matching `where`. */
function ownsAccount(transaction: Transaction, where: SQL | undefined) {
  return exists(
    transaction
      .select({ found: sql`1` })
      .from(account)
      .where(and(eq(account.userId, user.id), where)),
  );
}

/** Whether the person owns an account whose stored evidence matches `where`. */
function ownsEvidence(transaction: Transaction, where: SQL | undefined) {
  return exists(
    transaction
      .select({ found: sql`1` })
      .from(account)
      .innerJoin(
        identityEvidence,
        and(
          eq(account.issuer, identityEvidence.issuer),
          eq(account.accountId, identityEvidence.subject),
          eq(account.providerId, identityEvidence.providerId),
        ),
      )
      .where(and(eq(account.userId, user.id), where)),
  );
}

function groupCondition(transaction: Transaction, state: GroupTrait, listing: GroupListing): SQL {
  const issuer = entraIssuer();
  if (listing.source === "unconfigured" || !issuer) return sql`false`;
  const entra = and(eq(account.providerId, "pn-entra"), eq(account.issuer, issuer));
  if (listing.members) {
    if (!listing.members.size) return sql`false`;
    // One array parameter, however large the group is.
    const members = sql.param([...listing.members]);
    return ownsEvidence(
      transaction,
      and(entra, sql`${identityEvidence.externalId} = any(${members}::text[])`),
    );
  }
  return ownsEvidence(transaction, and(entra, sql`${state} = any(${identityEvidence.states})`));
}

/**
 * One boolean expression per trait, used both to filter and to report each row, so what
 * the list shows can never disagree with what it was filtered by.
 */
function traitConditions(
  transaction: Transaction,
  groups: Record<GroupTrait, GroupListing>,
  now: Date,
): Record<UserTrait, SQL> {
  return {
    socio: groupCondition(transaction, "socio", groups.socio),
    direttivo: groupCondition(transaction, "direttivo", groups.direttivo),
    student: ownsEvidence(
      transaction,
      and(
        eq(account.providerId, "polimi-email"),
        eq(account.issuer, POLIMI_EMAIL_ISSUER),
        sql`'student' = any(${identityEvidence.states})`,
        gt(identityEvidence.validUntil, now),
      ),
    ),
    telegram: ownsAccount(transaction, eq(account.providerId, "telegram")),
    google: ownsAccount(transaction, eq(account.providerId, "google")),
    polinetwork: ownsAccount(transaction, eq(account.providerId, "pn-entra")),
    passkey: exists(
      transaction
        .select({ found: sql`1` })
        .from(passkey)
        .where(eq(passkey.userId, user.id)),
    ),
  };
}

function searchCondition(transaction: Transaction, query: string) {
  const term = `%${query.replace(/[%_\\]/g, (match) => `\\${match}`)}%`;
  return or(
    ilike(user.name, term),
    ilike(user.email, term),
    eq(user.id, query),
    ownsAccount(
      transaction,
      and(eq(account.providerId, "polimi-email"), ilike(account.accountId, term)),
    ),
    ownsEvidence(
      transaction,
      and(eq(account.providerId, "pn-entra"), ilike(identityEvidence.email, term)),
    ),
    ownsEvidence(
      transaction,
      and(
        eq(account.providerId, "telegram"),
        eq(account.issuer, TELEGRAM_ISSUER),
        eq(identityEvidence.telegramId, query),
      ),
    ),
  );
}

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
      if (search.q) filters.push(searchCondition(transaction, search.q));
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
        .limit(USER_PAGE_SIZE)
        .offset((page - 1) * USER_PAGE_SIZE);

      const ids = rows.map((row) => row.id);
      const linked = ids.length
        ? await transaction
            .select({
              userId: account.userId,
              providerId: account.providerId,
              accountId: account.accountId,
              telegramId: identityEvidence.telegramId,
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
            polimiEmail: polimi?.accountId ?? null,
            roles: canReadRoles
              ? assigned.filter((entry) => entry.userId === row.id).map((entry) => entry.key)
              : null,
          };
        }),
        total,
        page,
        pageSize: USER_PAGE_SIZE,
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
        accounts: accounts.map((entry) => ({
          id: entry.id,
          providerId: entry.providerId,
          identifier:
            entry.providerId === "telegram" && entry.issuer === TELEGRAM_ISSUER
              ? entry.telegramId
              : entry.providerId === "polimi-email"
                ? entry.accountId
                : null,
          linkedAt: entry.createdAt.toISOString(),
          validUntil:
            entry.providerId === "polimi-email" && entry.validUntil
              ? entry.validUntil.toISOString()
              : null,
        })),
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
