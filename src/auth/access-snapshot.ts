import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { db } from "../db";
import {
  accessSnapshotState,
  account,
  entraGroupObservation,
  identityEvidence,
  role,
  user,
  userRole,
} from "../db/schema";
import { authorizationMutationLock } from "../db/security-lock";
import { env } from "../env";
import { listEntraGroupMembers } from "./membership";
import { ACCESS_PROJECTIONS } from "./access-projections";
import { effectiveRolePermissions, type RbacCatalog } from "./rbac";
import { readCatalog } from "./rbac-store";

const ENTRA_GRACE_MS = 3_600_000;
const SCHEMA = "polinetwork.access-snapshot/v1" as const;

export type AccessSource = {
  health: "ok" | "degraded";
  observedAt: string | null;
  error?: "graph_unavailable";
};
export type AccessSubject = {
  sub: string;
  telegramId: string | null;
  permissions: Record<string, { validUntil: string | null }>;
};
export type AccessSnapshot = {
  schema: typeof SCHEMA;
  projection: "backend";
  generation: number;
  builtAt: string;
  sources: Record<string, AccessSource>;
  subjects: AccessSubject[];
};

type Group = { source: string; roleKey: string; groupId: string };
type Observation = { source: string; groupId: string; members: string[]; observedAt: Date };
type Proof = {
  userId: string;
  providerId: string;
  issuer: string;
  externalId: string | null;
  states: string[];
  validUntil: Date;
  telegramId: string | null;
};

function configuredGroups(): Group[] {
  return [
    { source: "entra:soci", roleKey: "socio", groupId: env.PN_ENTRA_MEMBER_GROUP_ID },
    env.PN_ENTRA_DIRETTIVO_GROUP_ID
      ? {
          source: "entra:direttivo",
          roleKey: "direttivo",
          groupId: env.PN_ENTRA_DIRETTIVO_GROUP_ID,
        }
      : null,
    env.PN_ENTRA_OIDC_ADMIN_GROUP_ID
      ? {
          source: "entra:admins",
          roleKey: "master-admin",
          groupId: env.PN_ENTRA_OIDC_ADMIN_GROUP_ID,
        }
      : null,
  ].filter((group): group is Group => group !== null);
}

/** A failed Graph read leaves the last observation untouched and marks this pull degraded. */
async function refreshObservations(groups: Group[]): Promise<Set<string>> {
  const failed = new Set<string>();
  await Promise.all(
    groups.map(async (group) => {
      const members = await listEntraGroupMembers(group.groupId);
      if (!members) {
        failed.add(group.source);
        return;
      }
      const observedAt = new Date();
      await db
        .insert(entraGroupObservation)
        .values({
          source: group.source,
          groupId: group.groupId,
          members: [...members].sort(),
          observedAt,
        })
        .onConflictDoUpdate({
          target: entraGroupObservation.source,
          set: { groupId: group.groupId, members: [...members].sort(), observedAt },
          setWhere: sql`${entraGroupObservation.observedAt} < ${observedAt}`,
        });
    }),
  );
  return failed;
}

/** Builds only the backend's reviewed projection; every path carries its own expiry. */
export function projectBackendSubjects(input: {
  users: string[];
  manualRoles: { userId: string; roleKey: string }[];
  proofs: Proof[];
  catalog: RbacCatalog;
  groups: Group[];
  observations: Observation[];
  now: Date;
}): AccessSubject[] {
  const { users, manualRoles, proofs, catalog, groups, observations, now } = input;
  const permissions = new Map<string, Map<string, string | null>>(
    users.map((id) => [id, new Map()]),
  );
  const rolePermissions = new Map<string, string[]>();
  const grant = (userId: string, roleKey: string, validUntil: Date | null) => {
    const target = permissions.get(userId);
    if (!target || (validUntil && validUntil <= now)) return;
    let keys = rolePermissions.get(roleKey);
    if (!keys) {
      keys = effectiveRolePermissions(catalog, roleKey).filter((key) =>
        ACCESS_PROJECTIONS.backend.prefixes.some((prefix) => key.startsWith(prefix)),
      );
      rolePermissions.set(roleKey, keys);
    }
    const expiry = validUntil?.toISOString() ?? null;
    for (const key of keys) {
      const previous = target.get(key);
      if (previous === null) continue;
      if (previous === undefined || expiry === null || expiry > previous) target.set(key, expiry);
    }
  };

  for (const row of manualRoles) grant(row.userId, row.roleKey, null);
  for (const id of env.IDP_ADMIN_USER_IDS) grant(id, "master-admin", null);

  const entraIssuer = env.PN_ENTRA_TENANT_ID
    ? `https://login.microsoftonline.com/${env.PN_ENTRA_TENANT_ID}/v2.0`
    : null;
  const observed = new Map(observations.map((item) => [item.source, item]));
  for (const proof of proofs) {
    if (
      proof.providerId === "polimi-email" &&
      proof.issuer === "https://mail.polimi.it" &&
      proof.states.includes("student")
    )
      grant(proof.userId, "student", proof.validUntil);
    if (proof.providerId !== "pn-entra" || proof.issuer !== entraIssuer || !proof.externalId)
      continue;
    for (const group of groups) {
      const observation = observed.get(group.source);
      if (observation?.groupId === group.groupId && observation.members.includes(proof.externalId))
        grant(
          proof.userId,
          group.roleKey,
          new Date(observation.observedAt.getTime() + ENTRA_GRACE_MS),
        );
    }
  }

  const telegramIds = new Map<string, Set<string>>();
  for (const proof of proofs) {
    if (
      proof.providerId !== "telegram" ||
      proof.issuer !== "https://oauth.telegram.org" ||
      !proof.telegramId
    )
      continue;
    const ids = telegramIds.get(proof.userId) ?? new Set<string>();
    ids.add(proof.telegramId);
    telegramIds.set(proof.userId, ids);
  }
  const owners = new Map<string, number>();
  for (const ids of telegramIds.values())
    for (const id of ids) owners.set(id, (owners.get(id) ?? 0) + 1);
  const ambiguous =
    [...owners.values()].filter((count) => count > 1).length +
    [...telegramIds.values()].filter((ids) => ids.size > 1).length;
  if (ambiguous)
    console.error("Access snapshot excluded ambiguous Telegram links.", { count: ambiguous });

  return users
    .flatMap((sub): AccessSubject[] => {
      const held = permissions.get(sub);
      if (!held?.size) return [];
      const ids = telegramIds.get(sub);
      const id = ids?.size === 1 ? [...ids][0]! : null;
      const telegramId = id && owners.get(id) === 1 ? id : null;
      return [
        {
          sub,
          telegramId,
          permissions: Object.fromEntries(
            [...held.entries()]
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([key, validUntil]) => [key, { validUntil }]),
          ),
        },
      ];
    })
    .sort((a, b) => a.sub.localeCompare(b.sub));
}

export async function buildBackendSnapshot(): Promise<string> {
  const groups = configuredGroups();
  const failed = await refreshObservations(groups);
  return db.transaction(async (transaction) => {
    await transaction.execute(authorizationMutationLock);
    await transaction.execute(
      sql`select pg_advisory_xact_lock(hashtext('polinetwork-auth'), hashtext('access-snapshot'))`,
    );
    const now = new Date();
    const catalog = await readCatalog(transaction);
    const users = await transaction.select({ id: user.id }).from(user).orderBy(user.id);
    const manualRoles = await transaction
      .select({ userId: userRole.userId, roleKey: role.key })
      .from(userRole)
      .innerJoin(role, eq(userRole.roleId, role.id))
      .where(eq(role.managed, false));
    const proofs = await transaction
      .select({
        userId: account.userId,
        providerId: identityEvidence.providerId,
        issuer: identityEvidence.issuer,
        externalId: identityEvidence.externalId,
        states: identityEvidence.states,
        validUntil: identityEvidence.validUntil,
        telegramId: identityEvidence.telegramId,
      })
      .from(account)
      .innerJoin(
        identityEvidence,
        and(
          eq(account.issuer, identityEvidence.issuer),
          eq(account.accountId, identityEvidence.subject),
          eq(account.providerId, identityEvidence.providerId),
        ),
      );
    const observations = await transaction.select().from(entraGroupObservation);
    const sources: Record<string, AccessSource> = {};
    for (const group of groups) {
      const observation = observations.find(
        (item) => item.source === group.source && item.groupId === group.groupId,
      );
      sources[group.source] = {
        health: failed.has(group.source) ? "degraded" : "ok",
        observedAt: observation?.observedAt.toISOString() ?? null,
        ...(failed.has(group.source) ? { error: "graph_unavailable" as const } : {}),
      };
    }
    const subjects = projectBackendSubjects({
      users: users.map((row) => row.id),
      manualRoles,
      proofs,
      catalog,
      groups,
      observations,
      now,
    });
    const fingerprint = createHash("sha256")
      .update(JSON.stringify({ schema: SCHEMA, projection: "backend", sources, subjects }))
      .digest("hex");
    const [previous] = await transaction
      .select()
      .from(accessSnapshotState)
      .where(eq(accessSnapshotState.projection, "backend"));
    if (previous?.fingerprint === fingerprint) return previous.body;
    const builtAt = now.toISOString();
    const body: AccessSnapshot = {
      schema: SCHEMA,
      projection: "backend",
      generation: (previous?.generation ?? 0) + 1,
      builtAt,
      sources: {
        rbac: { health: "ok", observedAt: builtAt },
        ...sources,
        "polimi-email": { health: "ok", observedAt: builtAt },
      },
      subjects,
    };
    const serialized = JSON.stringify(body);
    await transaction
      .insert(accessSnapshotState)
      .values({ projection: "backend", generation: body.generation, fingerprint, body: serialized })
      .onConflictDoUpdate({
        target: accessSnapshotState.projection,
        set: { generation: body.generation, fingerprint, body: serialized },
      });
    return serialized;
  });
}
