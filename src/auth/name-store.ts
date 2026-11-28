import { randomUUID } from "node:crypto";
import { and, asc, eq, gte, sql } from "drizzle-orm";
import { decodeJwt, type JWTPayload } from "jose";
import { db } from "../db/index";
import { account, identityEvidence, rbacAuditEvent, user } from "../db/schema";
import { ActionError } from "../lib/action-error";
import { readEntraUserNames } from "./membership";
import {
  NAME_EDIT_LIMIT,
  NAME_EDIT_WINDOW_DAYS,
  directoryName,
  guessNameParts,
  joinName,
  needsNameConfirmation,
  type NameSource,
  type PersonName,
} from "./names";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Reader = Pick<typeof db, "select">;

/**
 * Name changes in the audit log, all on the person (`targetId`), with the names before and after:
 *
 * - `user.name.confirm`: they confirmed their self-declared name, once.
 * - `user.name.edit`: they changed it from the account page; these count toward the limit.
 * - `user.name.entra`: their PoliNetwork APS account set it from the directory.
 * - `user.name.release`: they unlinked that account, and the name became self-declared.
 */
export const NAME_AUDIT_OPERATIONS = {
  confirm: "user.name.confirm",
  edit: "user.name.edit",
  entra: "user.name.entra",
  release: "user.name.release",
} as const;

/** The names Better Auth's user rows start with: a guess from the provider's full name. */
export function initialNames(fullName: string | null | undefined) {
  return {
    ...guessNameParts(fullName ?? ""),
    nameSource: "self" as NameSource,
    nameConfirmedAt: null,
  };
}

const nameColumns = {
  givenName: user.givenName,
  familyName: user.familyName,
  nameSource: user.nameSource,
  nameConfirmedAt: user.nameConfirmedAt,
};

async function lockName(tx: Transaction, userId: string) {
  const [row] = await tx.select(nameColumns).from(user).where(eq(user.id, userId)).for("update");
  return row;
}

function hasEntraAccount(reader: Reader, userId: string) {
  return reader
    .select({ id: account.id })
    .from(account)
    .where(and(eq(account.userId, userId), eq(account.providerId, "pn-entra")))
    .limit(1)
    .then((rows) => rows.length > 0);
}

/** Recent edits that count toward the limit, oldest first. */
async function recentEdits(reader: Reader, userId: string, now: Date) {
  const since = new Date(now.getTime() - NAME_EDIT_WINDOW_DAYS * 86_400_000);
  return reader
    .select({ createdAt: rbacAuditEvent.createdAt })
    .from(rbacAuditEvent)
    .where(
      and(
        eq(rbacAuditEvent.operation, NAME_AUDIT_OPERATIONS.edit),
        eq(rbacAuditEvent.targetId, userId),
        gte(rbacAuditEvent.createdAt, since),
      ),
    )
    .orderBy(asc(rbacAuditEvent.createdAt));
}

/** When the next edit is allowed again, or null when one is allowed now. */
function nextEditAt(edits: { createdAt: Date }[]) {
  if (edits.length < NAME_EDIT_LIMIT) return null;
  const oldest = edits[edits.length - NAME_EDIT_LIMIT]!.createdAt;
  return new Date(oldest.getTime() + NAME_EDIT_WINDOW_DAYS * 86_400_000);
}

/** What the account page shows about the person's name and what they may do with it. */
export async function readNameDetails(userId: string, now = new Date()) {
  const [[row], entra, edits] = await Promise.all([
    db.select(nameColumns).from(user).where(eq(user.id, userId)),
    hasEntraAccount(db, userId),
    recentEdits(db, userId, now),
  ]);
  if (!row) throw new ActionError(404, "Account not found.");
  return {
    givenName: row.givenName,
    familyName: row.familyName,
    source: row.nameSource,
    /** Managed by PoliNetwork APS: shown, not editable. */
    managed: entra,
    needsConfirmation: !entra && needsNameConfirmation(row),
    editsLeft: Math.max(0, NAME_EDIT_LIMIT - edits.length),
    nextEditAt: nextEditAt(edits)?.toISOString() ?? null,
  };
}

export type NameDetails = Awaited<ReturnType<typeof readNameDetails>>;

function audit(
  tx: Transaction,
  operation: (typeof NAME_AUDIT_OPERATIONS)[keyof typeof NAME_AUDIT_OPERATIONS],
  actorId: string,
  userId: string,
  before: PersonName & { nameSource: string },
  after: PersonName & { nameSource: string },
) {
  return tx.insert(rbacAuditEvent).values({
    id: randomUUID(),
    actorId,
    operation,
    targetId: userId,
    before: {
      givenName: before.givenName,
      familyName: before.familyName,
      source: before.nameSource,
    },
    after: { givenName: after.givenName, familyName: after.familyName, source: after.nameSource },
  });
}

/**
 * Saves the name the person typed. The first time, it confirms their self-declared name;
 * afterwards it's an edit, refused past `NAME_EDIT_LIMIT` in `NAME_EDIT_WINDOW_DAYS`. Refused
 * while a PoliNetwork APS account is linked: then the directory's name applies.
 */
export async function saveSelfDeclaredName(userId: string, name: PersonName, now = new Date()) {
  return db.transaction(
    async (tx) => {
      // The row lock serializes this person's saves, so two at once can't both pass the limit.
      const current = await lockName(tx, userId);
      if (!current) throw new ActionError(404, "Account not found.");
      if (await hasEntraAccount(tx, userId))
        throw new ActionError(
          409,
          "Your name comes from your PoliNetwork APS account. To change it, ask the association to update it there.",
        );
      const confirming = needsNameConfirmation(current);
      const unchanged =
        current.givenName === name.givenName && current.familyName === name.familyName;
      if (!confirming && unchanged && current.nameSource === "self") return { saved: false };
      if (!confirming) {
        const next = nextEditAt(await recentEdits(tx, userId, now));
        if (next)
          throw new ActionError(
            429,
            `You can change your name ${NAME_EDIT_LIMIT} times in ${NAME_EDIT_WINDOW_DAYS} days. You can change it again on ${next.toISOString().slice(0, 10)}.`,
          );
      }
      await tx
        .update(user)
        .set({
          ...name,
          name: joinName(name),
          nameSource: "self",
          nameConfirmedAt: current.nameConfirmedAt ?? now,
        })
        .where(eq(user.id, userId));
      await audit(
        tx,
        confirming ? NAME_AUDIT_OPERATIONS.confirm : NAME_AUDIT_OPERATIONS.edit,
        userId,
        userId,
        current,
        { ...name, nameSource: "self" },
      );
      return { saved: true };
    },
    { isolationLevel: "read committed" },
  );
}

/**
 * After a PoliNetwork APS account is unlinked, inside the same transaction: the person keeps
 * the name, now as self-declared. One the directory supplied counts as confirmed; a guess it
 * never replaced is asked to be confirmed at the next sign-in. Nothing changes while another
 * one is still linked.
 */
export async function releaseEntraName(tx: Transaction, userId: string) {
  if (await hasEntraAccount(tx, userId)) return;
  const current = await lockName(tx, userId);
  if (!current || current.nameSource !== "entra") return;
  await tx.update(user).set({ nameSource: "self" }).where(eq(user.id, userId));
  await audit(tx, NAME_AUDIT_OPERATIONS.release, userId, userId, current, {
    ...current,
    nameSource: "self",
  });
}

/**
 * How old the directory's names saved in the evidence may be before a sign-in with another
 * method (passkey, Google) reads them again through Graph. A PoliNetwork APS sign-in always
 * reads them afresh.
 */
export const ENTRA_NAME_REFRESH_MS = 60 * 60_000;

// Entra object IDs whose Graph read failed recently, so one sign-in doesn't wait on Graph twice
// (once for the ID token, again when the session starts) and an outage doesn't slow every one.
const failedLookups = new Map<string, number>();
const LOOKUP_RETRY_MS = 10 * 60_000;

/** The directory's names from Graph, unless a read for this object failed a moment ago. */
async function lookUpEntraNames(objectId: string) {
  const failedAt = failedLookups.get(objectId);
  if (failedAt && Date.now() - failedAt < LOOKUP_RETRY_MS) return null;
  const names = await readEntraUserNames(objectId);
  if (names) failedLookups.delete(objectId);
  else {
    // Forget failures past their wait, so the map holds only the last few minutes' outages.
    const now = Date.now();
    for (const [id, at] of failedLookups) if (now - at >= LOOKUP_RETRY_MS) failedLookups.delete(id);
    failedLookups.set(objectId, now);
  }
  return names;
}

/**
 * The directory's names for a PoliNetwork APS sign-in: the ID token's `given_name` and
 * `family_name` when the app registration adds those optional claims, otherwise Microsoft Graph
 * (User.Read.All). Null when neither answers; the names stored before then stay.
 */
export async function entraNames(claims: JWTPayload, objectId: string | null) {
  return (
    directoryName(claims.given_name, claims.family_name) ??
    (objectId ? await lookUpEntraNames(objectId) : null)
  );
}

/** Google's `given_name`/`family_name` from the ID token of a linked Google account. */
function googleNames(idToken: string | null) {
  if (!idToken) return null;
  try {
    const claims = decodeJwt(idToken);
    return directoryName(claims.given_name, claims.family_name);
  } catch {
    return null;
  }
}

/**
 * Brings the person's names in line with their linked accounts, after every sign-in and every
 * new linked account (database hooks in `index.ts`):
 *
 * - With a PoliNetwork APS account: the directory's names, from the evidence its sign-in saved,
 *   read again through Graph when none was saved yet (people backfilled by the migration) or they
 *   are older than `ENTRA_NAME_REFRESH_MS`. When Graph doesn't answer, the saved ones apply; when
 *   there are none, the stored names stay, as an unverified `entra` guess.
 * - Without one, a name still marked `entra` (the account was removed some other way) becomes
 *   self-declared, as on unlinking.
 * - An unconfirmed self-declared name takes Google's first and last names when a Google
 *   account has them, as the suggestion the person then confirms.
 */
export async function syncNames(userId: string, now = new Date()) {
  const accounts = await db
    .select({
      providerId: account.providerId,
      subject: account.accountId,
      idToken: account.idToken,
      objectId: identityEvidence.externalId,
      givenName: identityEvidence.givenName,
      familyName: identityEvidence.familyName,
      namesCheckedAt: identityEvidence.namesCheckedAt,
      issuer: identityEvidence.issuer,
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
    .orderBy(asc(account.createdAt), asc(account.id));
  const entra = accounts.find((linked) => linked.providerId === "pn-entra");
  if (entra) {
    let names =
      entra.givenName !== null || entra.familyName !== null
        ? { givenName: entra.givenName ?? "", familyName: entra.familyName ?? "" }
        : null;
    const stale =
      !names ||
      !entra.namesCheckedAt ||
      now.getTime() - entra.namesCheckedAt.getTime() > ENTRA_NAME_REFRESH_MS;
    if (stale && entra.objectId && entra.issuer) {
      const fresh = await lookUpEntraNames(entra.objectId);
      if (fresh) {
        names = fresh;
        await db
          .update(identityEvidence)
          .set({ ...fresh, namesCheckedAt: now })
          .where(
            and(
              eq(identityEvidence.issuer, entra.issuer),
              eq(identityEvidence.subject, entra.subject),
            ),
          );
      }
    }
    await applyEntraName(userId, names, now);
    return;
  }
  await db.transaction(
    async (tx) => {
      const current = await lockName(tx, userId);
      if (!current) return;
      if (current.nameSource === "entra") {
        await releaseEntraName(tx, userId);
        return;
      }
      if (!needsNameConfirmation(current)) return;
      const google = accounts
        .filter((linked) => linked.providerId === "google")
        .map((linked) => googleNames(linked.idToken))
        .find((names) => names !== null);
      if (!google?.givenName || !google.familyName) return;
      if (current.givenName === google.givenName && current.familyName === google.familyName)
        return;
      // A suggestion for the person to confirm, not a change of their name: not audited.
      await tx
        .update(user)
        .set({ ...google, name: joinName(google) })
        .where(eq(user.id, userId));
    },
    { isolationLevel: "read committed" },
  );
}

/**
 * Sets the directory's names as `entra`, verified (`nameConfirmedAt` set). Without them it keeps
 * the stored names as `entra`, verified only if the directory supplied them before: a name the
 * person declared, or a guess, isn't the directory's.
 */
async function applyEntraName(userId: string, names: PersonName | null, now: Date) {
  await db.transaction(
    async (tx) => {
      const current = await lockName(tx, userId);
      // Unlinked meanwhile: `releaseEntraName` ran, or the next sign-in sorts it out.
      if (!current || !(await hasEntraAccount(tx, userId))) return;
      const next = names ?? current;
      const wasDirectory = current.nameSource === "entra" && current.nameConfirmedAt !== null;
      const confirmedAt = names
        ? wasDirectory
          ? current.nameConfirmedAt
          : now
        : current.nameSource === "entra"
          ? current.nameConfirmedAt
          : null;
      if (
        current.nameSource === "entra" &&
        current.nameConfirmedAt?.getTime() === confirmedAt?.getTime() &&
        current.givenName === next.givenName &&
        current.familyName === next.familyName
      )
        return;
      await tx
        .update(user)
        .set({
          givenName: next.givenName,
          familyName: next.familyName,
          name: joinName(next) || sql`${user.name}`,
          nameSource: "entra",
          nameConfirmedAt: confirmedAt,
        })
        .where(eq(user.id, userId));
      await audit(tx, NAME_AUDIT_OPERATIONS.entra, "system", userId, current, {
        ...next,
        nameSource: "entra",
      });
    },
    { isolationLevel: "read committed" },
  );
}

/** `syncNames` for a database hook: a failure is logged, never fails the sign-in. */
export async function syncNamesQuietly(userId: string) {
  try {
    await syncNames(userId);
  } catch (error) {
    console.error(
      "Couldn't bring a person's names in line with their accounts:",
      error instanceof Error ? error.message : "non-error value thrown",
    );
  }
}
