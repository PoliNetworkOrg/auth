import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";

const databaseURL = process.env.ACCESS_SNAPSHOT_TEST_DATABASE_URL;

describe.skipIf(!databaseURL)("app email claim integration", () => {
  const pool = new Pool({ connectionString: databaseURL });
  const ids = ["app-email-member", "app-email-guest", "app-email-google"];

  async function cleanup() {
    await pool.query(`DELETE FROM identity_evidence WHERE subject LIKE 'app-email-%'`);
    await pool.query(`DELETE FROM "user" WHERE id = ANY($1)`, [ids]);
  }

  beforeAll(async () => {
    await cleanup();
    await pool.query(
      `INSERT INTO "user" (id, name, email, email_verified) VALUES
        ('app-email-member', 'Member', 'member@outlook.it', true),
        ('app-email-guest', 'Guest', 'pn-entra.guest@identity.invalid', false),
        ('app-email-google', 'Google', 'someone@gmail.com', true)`,
    );
    await pool.query(
      `INSERT INTO account (id, provider_id, issuer, account_id, user_id, updated_at) VALUES
        ('app-email-member-entra', 'pn-entra', 'pn-entra', 'app-email-member', 'app-email-member', NOW()),
        ('app-email-guest-entra', 'pn-entra', 'pn-entra', 'app-email-guest', 'app-email-guest', NOW())`,
    );
    await pool.query(
      `INSERT INTO identity_evidence (issuer, subject, provider_id, states, valid_until, email) VALUES
        ('pn-entra', 'app-email-member', 'pn-entra', '{}', NOW() + interval '1 hour', 'Member@PoliNetwork.org'),
        ('pn-entra', 'app-email-guest', 'pn-entra', '{}', NOW() + interval '1 hour', 'guest@outlook.it')`,
    );
  });

  afterAll(async () => {
    await cleanup();
    await pool.end();
    const { db } = await import("../db");
    await db.$client.end();
  });

  async function emailFor(id: string) {
    const { db } = await import("../db");
    const { appEmail } = await import("./contact-email");
    const user = await pool.query<{ email: string; email_verified: boolean }>(
      `SELECT email, email_verified FROM "user" WHERE id = $1`,
      [id],
    );
    const { email, email_verified } = user.rows[0]!;
    return appEmail(db, { id, email, emailVerified: email_verified });
  }

  it("prefers a linked PoliNetwork address over the account email", async () => {
    expect(await emailFor("app-email-member")).toEqual({
      email: "Member@PoliNetwork.org",
      emailVerified: true,
    });
  });

  it("sends no placeholder and no non-PoliNetwork Entra address", async () => {
    expect(await emailFor("app-email-guest")).toEqual({ email: null, emailVerified: false });
  });

  it("keeps the account email when no PoliNetwork address is linked", async () => {
    expect(await emailFor("app-email-google")).toEqual({
      email: "someone@gmail.com",
      emailVerified: true,
    });
  });
});
