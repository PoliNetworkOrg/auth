import { type SQL, and, eq, exists, gt, ilike, or, sql } from "drizzle-orm";
import type { db } from "../db/index";
import { account, identityEvidence, passkey, user, userRole } from "../db/schema";
import { env } from "../env";
import { matchesSearch } from "../lib/search";
import { groupMembers } from "./group-listing";
import type { RbacCatalog } from "./rbac";
import { type GroupTrait, type MembershipSource, type UserTrait, USER_TRAITS } from "./users";

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
export async function groupListings(): Promise<Record<GroupTrait, GroupListing>> {
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
export function traitConditions(
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
    telegram: ownsAccount(
      transaction,
      and(eq(account.providerId, "telegram"), eq(account.issuer, TELEGRAM_ISSUER)),
    ),
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

export function searchCondition(
  transaction: Transaction,
  query: string,
  catalog: RbacCatalog,
  traits?: Record<UserTrait, SQL>,
  canReadRoles = false,
) {
  query = query.trim();
  const escaped = query.replace(/[%_\\]/g, (match) => `\\${match}`);
  const term = `%${escaped}%`;
  return or(
    ...(traits
      ? USER_TRAITS.filter((trait) =>
          matchesSearch(query, [trait.key, trait.label, trait.description]),
        ).map((trait) => traits[trait.key])
      : []),
    ...(canReadRoles
      ? catalog.roles
          .filter(
            (role) =>
              !role.managed && matchesSearch(query, [role.key, role.name, role.description]),
          )
          .map((role) =>
            exists(
              transaction
                .select({ found: sql`1` })
                .from(userRole)
                .where(and(eq(userRole.userId, user.id), eq(userRole.roleId, role.id))),
            ),
          )
      : []),
    ilike(user.name, term),
    ilike(user.email, term),
    eq(user.id, query),
    ownsAccount(
      transaction,
      and(
        eq(account.providerId, "polimi-email"),
        eq(account.issuer, POLIMI_EMAIL_ISSUER),
        ilike(account.accountId, term),
      ),
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
        or(
          ilike(identityEvidence.telegramId, term),
          // Usernames are case-insensitive on Telegram; the @ is optional.
          ilike(identityEvidence.telegramUsername, `%${escaped.replace(/^@/, "")}%`),
        ),
      ),
    ),
  );
}
