import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vite-plus/test";

// A disposable, migrated database, such as the one `vp run dev:setup` starts:
// DEV_SEED_TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:55432/polinetwork_auth
const databaseURL = process.env.DEV_SEED_TEST_DATABASE_URL;

if (databaseURL) {
  // `src/db` connects with the app's own settings, so point them at the same database.
  const url = new URL(databaseURL);
  Object.assign(process.env, {
    DB_HOST: url.hostname,
    DB_PORT: url.port || "5432",
    DB_USER: decodeURIComponent(url.username),
    DB_PASS: decodeURIComponent(url.password),
    DB_NAME: url.pathname.slice(1),
    BETTER_AUTH_URL: "http://localhost:3000",
    BETTER_AUTH_SECRET: "dev-seed-test-secret-at-least-32-characters",
    IDP_ADMIN_USER_IDS: "dev-admin",
  });
}

const TENANT = "11111111-1111-4111-8111-111111111111";
const PREFIX = "dev-fixture-test";

describe.skipIf(!databaseURL)("dev fixtures against PostgreSQL", () => {
  const pool = new Pool({ connectionString: databaseURL });
  let personas: typeof import("./personas");

  async function cleanup() {
    await pool.query(
      `DELETE FROM identity_evidence WHERE subject LIKE $1 OR telegram_id LIKE '9990%'`,
      [`${PREFIX}%`],
    );
    await pool.query(`DELETE FROM "user" WHERE id LIKE $1`, [`${PREFIX}%`]);
    await pool.query(`DELETE FROM role WHERE id LIKE $1 OR key LIKE $1`, [`${PREFIX}%`]);
  }

  beforeAll(async () => {
    personas = await import("./personas");
  });
  beforeEach(cleanup);
  afterAll(async () => {
    await cleanup();
    await pool.end();
    const { db } = await import("../db");
    await db.$client.end();
  });

  const query = async <T extends object>(text: string, values: unknown[] = []) =>
    (await pool.query<T & Record<string, unknown>>(text, values)).rows;

  const member = (id = `${PREFIX}-member`) => ({
    id,
    name: "Fixture Member",
    email: `${id}@example.com`,
    accounts: [
      {
        providerId: "pn-entra" as const,
        accountId: `${PREFIX}-entra-subject`,
        email: "fixture.member@polinetwork.org",
        states: ["socio"],
      },
    ],
  });

  it("moves an Entra account and its evidence together when the tenant gets configured", async () => {
    const placeholder = personas.devIssuers(undefined);
    const configured = personas.devIssuers(TENANT);
    await personas.saveDevUser(member(), placeholder);
    await personas.saveDevUser(member(), configured);
    // And once more: reseeding is idempotent.
    await personas.saveDevUser(member(), configured);

    expect(
      await query(`SELECT issuer, account_id FROM account WHERE user_id = $1`, [
        `${PREFIX}-member`,
      ]),
    ).toEqual([{ issuer: configured["pn-entra"], account_id: `${PREFIX}-entra-subject` }]);
    expect(
      await query(`SELECT issuer, email FROM identity_evidence WHERE subject = $1`, [
        `${PREFIX}-entra-subject`,
      ]),
    ).toEqual([{ issuer: configured["pn-entra"], email: "fixture.member@polinetwork.org" }]);

    // What apps receive as `email` is derived by joining the account to its evidence.
    const { db } = await import("../db");
    const { appEmail } = await import("../auth/contact-email");
    expect(
      await appEmail(db, {
        id: `${PREFIX}-member`,
        email: `${PREFIX}-member@example.com`,
        emailVerified: false,
      }),
    ).toEqual({ email: "fixture.member@polinetwork.org", emailVerified: true });
  });

  it("refuses an identity that belongs to someone else, changing nothing", async () => {
    await personas.saveDevUser(member(`${PREFIX}-owner`));
    const before = await query(`SELECT * FROM identity_evidence WHERE subject LIKE $1`, [
      `${PREFIX}%`,
    ]);
    await expect(personas.saveDevUser(member(`${PREFIX}-intruder`))).rejects.toThrow(
      personas.DevFixtureConflict,
    );
    expect(await query(`SELECT id FROM "user" WHERE id = $1`, [`${PREFIX}-intruder`])).toEqual([]);
    expect(
      await query(`SELECT user_id FROM account WHERE account_id = $1`, [`${PREFIX}-entra-subject`]),
    ).toEqual([{ user_id: `${PREFIX}-owner` }]);
    expect(
      await query(`SELECT * FROM identity_evidence WHERE subject LIKE $1`, [`${PREFIX}%`]),
    ).toEqual(before);
  });

  it("removes fixture accounts, and their evidence, that a person no longer has", async () => {
    const id = `${PREFIX}-shrinking`;
    await personas.saveDevUser({
      id,
      name: "Shrinking",
      email: `${id}@example.com`,
      accounts: [
        { providerId: "google", accountId: `${PREFIX}-google` },
        { providerId: "telegram", accountId: "999000001" },
        { providerId: "polimi-email", accountId: `${PREFIX}@mail.polimi.it`, states: ["student"] },
      ],
    });
    // A link made by hand (random ID) is not the fixture's to remove.
    await pool.query(
      `INSERT INTO account (id, provider_id, issuer, account_id, user_id, updated_at)
       VALUES ($1, 'google', 'https://hand.example', $2, $3, NOW())`,
      [`${PREFIX}-by-hand`, `${PREFIX}-by-hand`, id],
    );
    await personas.saveDevUser({
      id,
      name: "Shrinking",
      email: `${id}@example.com`,
      accounts: [{ providerId: "google", accountId: `${PREFIX}-google` }],
    });
    expect(
      (
        await query<{ id: string }>(`SELECT id FROM account WHERE user_id = $1 ORDER BY id`, [id])
      ).map((row) => row.id),
    ).toEqual([`${PREFIX}-by-hand`, `${id}:google`]);
    expect(
      await query(`SELECT * FROM identity_evidence WHERE subject IN ('999000001', $1)`, [
        `${PREFIX}@mail.polimi.it`,
      ]),
    ).toEqual([]);
  });

  it("clears orphaned proof of a Telegram ID but refuses one another person holds", async () => {
    // Left behind by an earlier link, with no account any more: cleared, as a real link would.
    await pool.query(
      `INSERT INTO identity_evidence (issuer, subject, provider_id, states, valid_until, telegram_id)
       VALUES ('https://oauth.telegram.org', $1, 'telegram', '{}', NOW() + interval '1 day', '999000002')`,
      [`${PREFIX}-orphan`],
    );
    const id = `${PREFIX}-telegram`;
    const telegram = (accountId: string) => ({
      id,
      name: "Telegram",
      email: `${id}@example.com`,
      accounts: [
        { providerId: "google" as const, accountId: `${PREFIX}-tg-google` },
        { providerId: "telegram" as const, accountId },
      ],
    });
    await personas.saveDevUser(telegram("999000002"));
    expect(
      await query(`SELECT subject FROM identity_evidence WHERE telegram_id = '999000002'`),
    ).toEqual([{ subject: "999000002" }]);

    // Proven for someone else, through an account they hold: never taken over.
    await pool.query(
      `INSERT INTO "user" (id, name, email, email_verified) VALUES ($1, 'Other', $2, false)`,
      [`${PREFIX}-other`, `${PREFIX}-other@example.com`],
    );
    await pool.query(
      `INSERT INTO account (id, provider_id, issuer, account_id, user_id, updated_at)
       VALUES ($1, 'telegram', 'https://other-telegram.example', $2, $1, NOW())`,
      [`${PREFIX}-other`, `${PREFIX}-other-subject`],
    );
    await pool.query(
      `INSERT INTO identity_evidence (issuer, subject, provider_id, states, valid_until, telegram_id)
       VALUES ('https://other-telegram.example', $1, 'telegram', '{}', NOW() + interval '1 day', '999000003')`,
      [`${PREFIX}-other-subject`],
    );
    await expect(personas.saveDevUser(telegram("999000003"))).rejects.toThrow(/999000003/);
  });

  describe("fixture roles", () => {
    const staff = (key = `${PREFIX}-role`) => ({
      id: `${PREFIX}-staff`,
      name: "Staff",
      email: `${PREFIX}-staff@example.com`,
      accounts: [{ providerId: "google" as const, accountId: `${PREFIX}-staff-google` }],
      roles: [
        {
          id: `${PREFIX}-role`,
          key,
          name: "Fixture staff",
          description: "Test role",
          permissions: ["idp:users:read", "idp:roles:read"],
        },
      ],
    });
    const assigned = () =>
      query(
        `SELECT r.id, r.key FROM user_role ur JOIN role r ON r.id = ur.role_id WHERE ur.user_id = $1`,
        [`${PREFIX}-staff`],
      );

    it("survives the role's key being renamed in the role editor", async () => {
      await personas.saveDevUser(staff());
      await pool.query(`UPDATE role SET key = $1, name = 'Renamed' WHERE id = $2`, [
        `${PREFIX}-renamed`,
        `${PREFIX}-role`,
      ]);
      await personas.saveDevUser(staff());
      expect(await assigned()).toEqual([{ id: `${PREFIX}-role`, key: `${PREFIX}-renamed` }]);
      expect(await query(`SELECT name FROM role WHERE id = $1`, [`${PREFIX}-role`])).toEqual([
        { name: "Renamed" },
      ]);
      expect(
        await query(
          `SELECT p.key FROM role_permission rp JOIN permission p ON p.id = rp.permission_id
           WHERE rp.role_id = $1 ORDER BY p.key`,
          [`${PREFIX}-role`],
        ),
      ).toEqual([{ key: "idp:roles:read" }, { key: "idp:users:read" }]);
    });

    it("reuses a role created by hand under the fixture's key", async () => {
      await pool.query(`INSERT INTO role (id, key, name) VALUES ($1, $2, 'By hand')`, [
        `${PREFIX}-by-hand-role`,
        `${PREFIX}-role`,
      ]);
      await personas.saveDevUser(staff());
      await personas.saveDevUser(staff());
      expect(await assigned()).toEqual([{ id: `${PREFIX}-by-hand-role`, key: `${PREFIX}-role` }]);
    });
  });
});
