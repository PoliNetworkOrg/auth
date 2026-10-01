/**
 * Test people for local development, written straight into the database. Only the dev
 * sign-in endpoint and `src/dev/seed.ts` import this module, and production builds include
 * neither, so nothing here can run against production.
 */
import { inArray, eq } from "drizzle-orm";
import { db } from "../db";
import {
  account,
  identityEvidence,
  permission,
  role,
  rolePermission,
  user,
  userRole,
} from "../db/schema";
import { env } from "../env";
import type { DevPersonaSummary } from "./shared";

type Provider = "google" | "pn-entra" | "telegram" | "polimi-email";

export type DevAccount = {
  providerId: Provider;
  /** The provider's subject: an opaque ID, a Telegram user ID, or the Polimi address. */
  accountId: string;
  /** Identity evidence states, such as `student`. Only Polimi evidence is trusted from the
   * database; Socio and Direttivo are always rechecked against Entra, so here they are
   * display data only. */
  states?: string[];
  /** The address shown for a PoliNetwork account. */
  email?: string;
};

export type DevRole = { key: string; name: string; description: string; permissions: string[] };

export type DevUser = {
  id: string;
  name: string;
  email: string;
  createdAt?: Date;
  accounts: DevAccount[];
  roles?: DevRole[];
};

type DevPersona = DevUser & { key: string; description: string };

const ISSUERS: Record<Provider, string> = {
  google: "https://accounts.google.com",
  // Without a configured tenant no Entra evidence is trusted anyway, so any well-formed
  // issuer will do for display.
  "pn-entra": `https://login.microsoftonline.com/${env.PN_ENTRA_TENANT_ID ?? "00000000-0000-0000-0000-000000000000"}/v2.0`,
  telegram: "https://oauth.telegram.org",
  "polimi-email": "https://mail.polimi.it",
};

/** The persona that holds Master Admin, when `.env.local` lists it in `IDP_ADMIN_USER_IDS`. */
export const DEV_ADMIN_ID = "dev-admin";

export const DEV_PERSONAS: DevPersona[] = [
  {
    key: "admin",
    id: DEV_ADMIN_ID,
    name: "Ada Admin",
    email: "admin@polinetwork.test",
    description: "Master Admin: every permission",
    accounts: [{ providerId: "google", accountId: "dev-admin" }],
  },
  {
    key: "staff",
    id: "dev-staff",
    name: "Sam Staff",
    email: "staff@polinetwork.test",
    description: "Can read the user directory and roles, nothing else",
    accounts: [{ providerId: "google", accountId: "dev-staff" }],
    roles: [
      {
        key: "dev-staff",
        name: "Dev staff",
        description: "Created by the dev sign-in for the staff persona.",
        permissions: ["idp:users:read", "idp:roles:read"],
      },
    ],
  },
  {
    key: "student",
    id: "dev-student",
    name: "Stella Student",
    email: "student@polinetwork.test",
    description: "Verified Polimi student with Telegram linked, no admin access",
    accounts: [
      { providerId: "google", accountId: "dev-student" },
      {
        providerId: "polimi-email",
        accountId: "stella.student@mail.polimi.it",
        states: ["student"],
      },
      { providerId: "telegram", accountId: "100000001" },
    ],
  },
  {
    key: "member",
    id: "dev-member",
    name: "Nico Newcomer",
    email: "member@polinetwork.test",
    description: "Just signed up with Google: no statuses, no roles",
    accounts: [{ providerId: "google", accountId: "dev-member" }],
  },
];

export function findPersona(key: string) {
  return DEV_PERSONAS.find((persona) => persona.key === key);
}

export function listPersonas(): DevPersonaSummary[] {
  return DEV_PERSONAS.map(({ key, name, description, id }) => ({
    key,
    name,
    description,
    ...(id === DEV_ADMIN_ID && !env.IDP_ADMIN_USER_IDS.includes(DEV_ADMIN_ID)
      ? {
          warning: `Add ${DEV_ADMIN_ID} to IDP_ADMIN_USER_IDS in .env.local to make this Master Admin.`,
        }
      : {}),
  }));
}

type Writer = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function saveRole(transaction: Writer, userId: string, entry: DevRole) {
  await transaction
    .insert(role)
    .values({ id: entry.key, key: entry.key, name: entry.name, description: entry.description })
    .onConflictDoNothing({ target: role.key });
  const [saved] = await transaction
    .select({ id: role.id })
    .from(role)
    .where(eq(role.key, entry.key));
  const permissions = await transaction
    .select({ id: permission.id })
    .from(permission)
    .where(inArray(permission.key, entry.permissions));
  // Only adds what is missing, so edits made through the UI while testing survive.
  if (permissions.length)
    await transaction
      .insert(rolePermission)
      .values(permissions.map(({ id }) => ({ roleId: saved!.id, permissionId: id })))
      .onConflictDoNothing();
  await transaction
    .insert(userRole)
    .values({ userId, roleId: saved!.id, assignedBy: "dev-login" })
    .onConflictDoNothing();
}

/** Creates or refreshes a test person, their linked accounts, evidence, and roles. */
export async function saveDevUser(entry: DevUser) {
  const now = new Date();
  const validUntil = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1_000);
  await db.transaction(async (transaction) => {
    await transaction
      .insert(user)
      .values({
        id: entry.id,
        name: entry.name,
        email: entry.email,
        emailVerified: false,
        ...(entry.createdAt ? { createdAt: entry.createdAt, updatedAt: entry.createdAt } : {}),
      })
      .onConflictDoUpdate({ target: user.id, set: { name: entry.name, email: entry.email } });

    for (const linked of entry.accounts) {
      const issuer = ISSUERS[linked.providerId];
      await transaction
        .insert(account)
        .values({
          id: `${entry.id}:${linked.providerId}`,
          accountId: linked.accountId,
          providerId: linked.providerId,
          issuer,
          userId: entry.id,
          updatedAt: now,
        })
        .onConflictDoNothing();
      if (linked.providerId === "google") continue;
      // Evidence is refreshed on every save so it never expires mid-session.
      const proof = {
        issuer,
        subject: linked.accountId,
        providerId: linked.providerId,
        states: linked.states ?? [],
        validUntil,
        telegramId: linked.providerId === "telegram" ? linked.accountId : null,
        email: linked.email ?? null,
      };
      await transaction
        .insert(identityEvidence)
        .values(proof)
        .onConflictDoUpdate({
          target: [identityEvidence.issuer, identityEvidence.subject],
          set: proof,
        });
    }

    for (const entryRole of entry.roles ?? []) await saveRole(transaction, entry.id, entryRole);
  });
}
