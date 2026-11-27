import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, describe, expect, it, vi } from "vite-plus/test";

const TENANT = "11111111-1111-4111-8111-111111111111";

vi.mock("../env", () => {
  const url = new URL(
    process.env.RBAC_TEST_DATABASE_URL ??
      "postgresql://postgres:test@localhost:55439/auth_security",
  );
  return {
    env: {
      DB_HOST: url.hostname,
      DB_PORT: Number(url.port),
      DB_USER: url.username,
      DB_PASS: url.password,
      DB_NAME: url.pathname.slice(1),
      BETTER_AUTH_URL: "http://localhost:35439",
      BETTER_AUTH_SECRET: "test-only-secret-with-at-least-32-characters",
      STUDENT_VERIFICATION_TTL_DAYS: 365,
      IDP_ADMIN_USER_IDS: ["issuer-root"],
      PN_ENTRA_TENANT_ID: "11111111-1111-4111-8111-111111111111",
      PN_ENTRA_MEMBER_GROUP_ID: "soci",
    },
  };
});
vi.mock("./membership", () => ({
  checkEntraGroupMember: vi.fn().mockResolvedValue(false),
  listEntraGroupMembers: vi.fn().mockResolvedValue(null),
}));

/**
 * Better Auth 1.7.3+ no longer writes `account.issuer`; the app's `account.create.before` hook
 * does. These go through Better Auth's own account paths (sign-up and linking), against the
 * migrated schema, so a regression shows up as a refused or issuer-less account here.
 */
describe.skipIf(!process.env.RBAC_TEST_DATABASE_URL)("account issuer with PostgreSQL", () => {
  const pool = new Pool({ connectionString: process.env.RBAC_TEST_DATABASE_URL });
  const prefix = `issuer-${randomUUID().slice(0, 8)}`;
  const unique = (label: string) => `${prefix}-${label}-${randomUUID().slice(0, 8)}`;

  async function internalAdapter() {
    const { auth } = await import("./index");
    return (await auth.$context).internalAdapter;
  }

  async function storedIssuer(providerId: string, accountId: string) {
    const { rows } = await pool.query<{ issuer: string }>(
      `SELECT issuer FROM account WHERE provider_id = $1 AND account_id = $2`,
      [providerId, accountId],
    );
    return rows.map((row) => row.issuer);
  }

  afterAll(async () => {
    await pool.query(`DELETE FROM "user" WHERE id LIKE $1`, [`${prefix}%`]);
    await pool.query(`DELETE FROM "user" WHERE email LIKE $1`, [`${prefix}%`]);
    await pool.end();
    const { db } = await import("../db/index");
    await db.$client.end();
  });

  it("stores the provider's issuer on an account created at sign-up", async () => {
    const adapter = await internalAdapter();
    const accountId = unique("entra-subject");
    const { user } = await adapter.createOAuthUser(
      { email: `${unique("signup")}@identity.invalid`, name: "Sign-up", emailVerified: false },
      { providerId: "pn-entra", accountId },
    );
    expect(user.id).toBeTruthy();
    expect(await storedIssuer("pn-entra", accountId)).toEqual([
      `https://login.microsoftonline.com/${TENANT}/v2.0`,
    ]);
    // Better Auth finds it again by its provider key.
    expect(await adapter.findAccountByKey({ providerId: "pn-entra", accountId })).toMatchObject({
      userId: user.id,
    });
  });

  it.each([
    ["telegram", "https://oauth.telegram.org"],
    ["google", "https://accounts.google.com"],
  ])("stores %s's issuer on a linked account", async (providerId, issuer) => {
    const adapter = await internalAdapter();
    const userId = unique("linker");
    await pool.query(
      `INSERT INTO "user" (id, name, email) VALUES ($1, $1, $1 || '@identity.invalid')`,
      [userId],
    );
    const accountId = unique(`${providerId}-subject`);
    await adapter.linkAccount({ providerId, accountId, userId });
    expect(await storedIssuer(providerId, accountId)).toEqual([issuer]);
  });

  it("refuses an account at a provider with no known issuer", async () => {
    const adapter = await internalAdapter();
    const userId = unique("unknown");
    await pool.query(
      `INSERT INTO "user" (id, name, email) VALUES ($1, $1, $1 || '@identity.invalid')`,
      [userId],
    );
    const accountId = unique("github-subject");
    await expect(adapter.linkAccount({ providerId: "github", accountId, userId })).rejects.toThrow(
      /No account issuer/,
    );
    expect(await storedIssuer("github", accountId)).toEqual([]);
  });

  it("keeps one provider account to one person", async () => {
    const adapter = await internalAdapter();
    const [first, second] = [unique("first"), unique("second")];
    for (const id of [first, second])
      await pool.query(
        `INSERT INTO "user" (id, name, email) VALUES ($1, $1, $1 || '@identity.invalid')`,
        [id],
      );
    const accountId = unique("shared-subject");
    await adapter.linkAccount({ providerId: "telegram", accountId, userId: first });
    await expect(
      adapter.linkAccount({ providerId: "telegram", accountId, userId: second }),
    ).rejects.toThrow();
    expect(await storedIssuer("telegram", accountId)).toHaveLength(1);
  });
});
