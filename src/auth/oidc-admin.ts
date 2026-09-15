import { and, eq, isNotNull } from "drizzle-orm";
import { identityEvidence } from "../db/evidence";
import { db } from "../db/index";
import { account } from "../db/schema";
import { env } from "../env";
import { checkEntraGroupMember } from "./membership";

/**
 * Who holds the built-in Master Admin role, and through it every permission.
 * - `pn-entra`: anyone who signed in with a PoliNetwork Entra account (the initial rule).
 * - `entra-group`: only direct members of `PN_ENTRA_OIDC_ADMIN_GROUP_ID`, a stricter group
 *   than Soci. Set that variable to switch without code changes.
 * `IDP_ADMIN_USER_IDS` remains a break-glass allowlist in both modes.
 *
 * This is the one decision that is deliberately made outside the database, so a mistake in
 * the roles cannot lock the service out of its own administration. Every other
 * administrative right is an ordinary permission resolved through RBAC.
 */
export type OidcAdminPolicy = "pn-entra" | "entra-group";

export function oidcAdminPolicy(): OidcAdminPolicy {
  return env.PN_ENTRA_OIDC_ADMIN_GROUP_ID ? "entra-group" : "pn-entra";
}

export type OidcAdminDecisionInput = {
  allowlisted: boolean;
  pnEntraAccount: boolean;
  groupConfigured: boolean;
  groupMember: boolean;
};

export function decideOidcAdmin(input: OidcAdminDecisionInput): boolean {
  if (input.allowlisted) return true;
  if (!input.pnEntraAccount) return false;
  if (!input.groupConfigured) return true;
  return input.groupMember;
}

type GroupCheck = (groupId: string, objectId: string) => Promise<boolean | null>;

/**
 * Remembers Graph answers for a short time so every management request does not page
 * through the group. Failed checks are never cached and grant nothing.
 */
export function createGroupMembershipCache(check: GroupCheck, ttlMs: number, now = Date.now) {
  const cache = new Map<string, { member: boolean; expiresAt: number }>();
  return async (groupId: string, objectId: string): Promise<boolean> => {
    const key = `${groupId} ${objectId}`;
    const cached = cache.get(key);
    if (cached && cached.expiresAt > now()) return cached.member;
    const member = await check(groupId, objectId);
    if (member === null) return false;
    if (cache.size >= 1000) {
      for (const [entryKey, entry] of cache) if (entry.expiresAt <= now()) cache.delete(entryKey);
    }
    cache.set(key, { member, expiresAt: now() + ttlMs });
    return member;
  };
}

const ADMIN_GROUP_CACHE_MS = 15 * 60_000;
const adminGroupMember = createGroupMembershipCache(checkEntraGroupMember, ADMIN_GROUP_CACHE_MS);

// Entra object IDs of the user's verified PoliNetwork tenant accounts.
async function pnEntraObjectIds(userId: string): Promise<string[]> {
  if (!env.PN_ENTRA_TENANT_ID) return [];
  const issuer = `https://login.microsoftonline.com/${env.PN_ENTRA_TENANT_ID}/v2.0`;
  const rows = await db
    .select({ externalId: identityEvidence.externalId })
    .from(account)
    .innerJoin(
      identityEvidence,
      and(
        eq(account.issuer, identityEvidence.issuer),
        eq(account.accountId, identityEvidence.subject),
      ),
    )
    .where(
      and(
        eq(account.userId, userId),
        eq(account.providerId, "pn-entra"),
        eq(account.issuer, issuer),
        isNotNull(identityEvidence.externalId),
      ),
    );
  return rows.flatMap((row) => (row.externalId ? [row.externalId] : []));
}

export async function canAdministerIdp(userId: string): Promise<boolean> {
  if (env.IDP_ADMIN_USER_IDS.includes(userId)) return true;
  const objectIds = await pnEntraObjectIds(userId);
  const groupId = env.PN_ENTRA_OIDC_ADMIN_GROUP_ID;
  let groupMember = false;
  if (groupId) {
    for (const objectId of objectIds) {
      if (await adminGroupMember(groupId, objectId)) {
        groupMember = true;
        break;
      }
    }
  }
  return decideOidcAdmin({
    allowlisted: false,
    pnEntraAccount: objectIds.length > 0,
    groupConfigured: Boolean(groupId),
    groupMember,
  });
}
