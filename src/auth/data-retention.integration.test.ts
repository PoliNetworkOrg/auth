import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";

const databaseURL = process.env.ACCESS_SNAPSHOT_TEST_DATABASE_URL;
const DAY_MS = 86_400_000;

describe.skipIf(!databaseURL)("data retention integration", () => {
  const pool = new Pool({ connectionString: databaseURL });
  const suffix = randomUUID().slice(0, 8);
  const person = `retention-${suffix}`;
  const clientId = `retention-client-${suffix}`;
  const daysAgo = (days: number) => new Date(Date.now() - days * DAY_MS);
  const ids = (table: string, column: string, values: string[]) =>
    pool
      .query<{ id: string }>(`SELECT ${column} AS id FROM ${table} WHERE ${column} = ANY($1)`, [
        values,
      ])
      .then(({ rows }) => rows.map((row) => row.id).sort());

  beforeAll(async () => {
    await pool.query(`INSERT INTO "user" (id, name, email) VALUES ($1, $1, $1 || '@x.invalid')`, [
      person,
    ]);
    await pool.query(
      `INSERT INTO oauth_client (id, client_id, name, reference_id, redirect_uris)
       VALUES ($1, $1, 'Retention client', 'polinetwork', ARRAY['https://example.invalid/cb'])`,
      [clientId],
    );
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM "user" WHERE id = $1`, [person]);
    await pool.query(`DELETE FROM oauth_client WHERE client_id = $1`, [clientId]);
    await pool.query(`DELETE FROM verification WHERE identifier = $1`, [person]);
    await pool.end();
    const { db } = await import("../db");
    await db.$client.end();
  });

  it("deletes sessions, verifications and OAuth tokens 30 days after they expire", async () => {
    const [stale, recent] = [daysAgo(31), daysAgo(29)];
    await pool.query(
      `INSERT INTO session (id, token, user_id, expires_at, updated_at, ip_address, user_agent)
       VALUES ($1 || '-stale', $1 || '-stale', $1, $2, NOW(), '192.0.2.1', 'test'),
              ($1 || '-recent', $1 || '-recent', $1, $3, NOW(), '192.0.2.1', 'test')`,
      [person, stale, recent],
    );
    await pool.query(
      `INSERT INTO verification (id, identifier, value, expires_at)
       VALUES ($1 || '-stale', $1, 'v', $2), ($1 || '-recent', $1, 'v', $3)`,
      [person, stale, recent],
    );
    await pool.query(
      `INSERT INTO oauth_refresh_token (id, token, client_id, user_id, expires_at, created_at, scopes)
       VALUES ($1 || '-stale', $1 || '-stale', $2, $1, $3, NOW(), ARRAY['openid']),
              ($1 || '-recent', $1 || '-recent', $2, $1, $4, NOW(), ARRAY['openid'])`,
      [person, clientId, stale, recent],
    );
    await pool.query(
      `INSERT INTO oauth_access_token (id, token, client_id, user_id, expires_at, created_at, scopes)
       VALUES ($1 || '-stale', $1 || '-stale', $2, $1, $3, NOW(), ARRAY['openid']),
              ($1 || '-recent', $1 || '-recent', $2, $1, $4, NOW(), ARRAY['openid'])`,
      [person, clientId, stale, recent],
    );

    const { pruneExpiredData } = await import("./data-retention");
    await pruneExpiredData();

    const both = [`${person}-recent`, `${person}-stale`];
    for (const table of ["session", "verification", "oauth_refresh_token", "oauth_access_token"]) {
      expect(await ids(table, "id", both)).toEqual([`${person}-recent`]);
    }
  });

  it("deletes audit events only once they are five years old", async () => {
    const [old, retained] = [`${person}-audit-old`, `${person}-audit-retained`];
    await pool.query(
      `INSERT INTO rbac_audit_event (id, actor_id, operation, target_id, before, after, "createdAt")
       VALUES ($1, 'retention-test', 'retention.test', $3, '{}', '{}', NOW() - interval '5 years 1 day'),
              ($2, 'retention-test', 'retention.test', $3, '{}', '{}', NOW() - interval '5 years' + interval '1 day')`,
      [old, retained, person],
    );

    // Every statement touching a retained event is refused, even alongside an expired one.
    await expect(
      pool.query(`DELETE FROM rbac_audit_event WHERE target_id = $1`, [person]),
    ).rejects.toThrow("append-only");
    await expect(
      pool.query(
        `UPDATE rbac_audit_event SET "createdAt" = NOW() - interval '6 years' WHERE id = $1`,
        [retained],
      ),
    ).rejects.toThrow("append-only");
    await expect(pool.query(`TRUNCATE rbac_audit_event`)).rejects.toThrow("append-only");
    expect(await ids("rbac_audit_event", "id", [old, retained])).toEqual([old, retained].sort());

    const { pruneExpiredData } = await import("./data-retention");
    await pruneExpiredData();
    expect(await ids("rbac_audit_event", "id", [old, retained])).toEqual([retained]);
  });
});
