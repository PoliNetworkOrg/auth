import { and, desc, eq, gt } from "drizzle-orm";
import { decodeJwt } from "jose";
import { account, session, user } from "../db/auth-schema";
import { identityEvidence } from "../db/evidence";
import { db } from "../db/index";
import { appEmail, claimEmail } from "./contact-email";
import type { IdentityClaims } from "./policy";
import { STATIC_ROLES } from "./rbac";
import { readCatalog } from "./rbac-store";
import { isPlaceholderEmail } from "./users";

/** The sign-in accounts whose address the account page shows on its card. */
const EMAIL_PROVIDERS = ["google", "pn-entra"] as const;

/** Socio and Direttivo are groups in PoliNetwork's Entra tenant, so they read as groups. */
const GROUP_STATES = ["socio", "direttivo"];

/**
 * What the account page shows besides the linked accounts and passkeys: the address on each
 * sign-in card, the groups and permissions the person holds by name, their live sessions,
 * and a few facts for debugging. Session tokens are never selected: they are the bearer
 * secret in the cookie.
 */
export async function readAccountOverview(
  userId: string,
  currentSessionId: string,
  identity: IdentityClaims,
) {
  const [[person], linked, catalog, sessions] = await Promise.all([
    db
      .select({
        id: user.id,
        email: user.email,
        emailVerified: user.emailVerified,
        createdAt: user.createdAt,
      })
      .from(user)
      .where(eq(user.id, userId)),
    db
      .select({
        providerId: account.providerId,
        idToken: account.idToken,
        saved: identityEvidence.email,
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
      .where(eq(account.userId, userId)),
    readCatalog(db),
    // Read from the table: Better Auth's list endpoint refuses sessions older than its
    // fresh age, which would hide the list from anyone signed in for more than a day.
    db
      .select({
        id: session.id,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        expiresAt: session.expiresAt,
        ipAddress: session.ipAddress,
        userAgent: session.userAgent,
      })
      .from(session)
      .where(and(eq(session.userId, userId), gt(session.expiresAt, new Date())))
      .orderBy(desc(session.updatedAt)),
  ]);

  const emails: Record<(typeof EMAIL_PROVIDERS)[number], string | null> = {
    google: null,
    "pn-entra": null,
  };
  for (const provider of EMAIL_PROVIDERS) {
    for (const row of linked.filter((entry) => entry.providerId === provider)) {
      emails[provider] ??= signInEmail(row.saved, row.idToken);
    }
  }

  const roles = new Map(catalog.roles.map((role) => [role.key, role]));
  const permissions = new Map(catalog.permissions.map((entry) => [entry.key, entry]));
  const automatic = STATIC_ROLES.filter(
    (role) =>
      role.state && GROUP_STATES.includes(role.state) && identity.states.includes(role.state),
  ).map((role) => ({
    key: role.key,
    // An administrator may have renamed or described the built-in role.
    name: roles.get(role.key)?.name ?? role.name,
    description: roles.get(role.key)?.description ?? role.description,
    automatic: true,
  }));
  const assigned = identity.roles.flatMap((key) => {
    const role = roles.get(key);
    return role && !role.managed
      ? [{ key, name: role.name, description: role.description, automatic: false }]
      : [];
  });

  const current = sessions.find((entry) => entry.id === currentSessionId);
  return {
    primaryEmail: person ? (await appEmail(db, person)).email : null,
    emails,
    telegramUsername:
      linked.find((entry) => entry.providerId === "telegram")?.telegramUsername ?? null,
    groups: [...automatic, ...assigned],
    permissions: identity.permissions.map((key) => ({
      key,
      name: permissions.get(key)?.name ?? key,
    })),
    sessions: sessions.map((entry) => ({ ...entry, current: entry.id === currentSessionId })),
    debug: {
      userId,
      userCreatedAt: person?.createdAt ?? null,
      session: current ?? null,
      roleKeys: identity.roles,
      states: identity.states,
    },
  };
}

/**
 * The address saved at an account's last sign-in, or else the one in its ID token. The token
 * was accepted during the OAuth sign-in and is only read for a label here.
 */
function signInEmail(saved: string | null, idToken: string | null) {
  if (saved && !isPlaceholderEmail(saved)) return saved;
  if (!idToken) return null;
  try {
    return claimEmail(decodeJwt(idToken)) ?? null;
  } catch {
    return null;
  }
}

/** The token of one of the person's own sessions, or null. It never leaves the server. */
export async function ownSessionToken(userId: string, sessionId: string) {
  const [row] = await db
    .select({ token: session.token })
    .from(session)
    .where(and(eq(session.id, sessionId), eq(session.userId, userId)));
  return row?.token ?? null;
}
