import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";

const databaseURL = process.env.ACCESS_SNAPSHOT_TEST_DATABASE_URL;
const root = process.env.IDENTITY_TEST_ADMIN_USER_ID;

describe.skipIf(!databaseURL || !root)("Phase 1 audit and deletion integration", () => {
  const pool = new Pool({ connectionString: databaseURL });
  const suffix = randomUUID().slice(0, 8);
  const person = `audit-integration-${suffix}`;
  const clientId = `audit-client-${suffix}`;

  beforeAll(async () => {
    await pool.query(`DELETE FROM "user" WHERE id = $1`, [person]);
    await pool.query(`DELETE FROM "user" WHERE id = $1`, [root]);
    await pool.query(`DELETE FROM oauth_client WHERE client_id = $1`, [clientId]);
    await pool.query(
      `INSERT INTO "user" (id, name, email) VALUES
        ($1, 'Root', $3),
        ($2, 'Audit User', $4)`,
      [
        root,
        person,
        `audit-root-${suffix}@identity.invalid`,
        `audit-user-${suffix}@identity.invalid`,
      ],
    );
    await pool.query(
      `INSERT INTO account (id, provider_id, issuer, account_id, user_id, updated_at)
       VALUES ('audit-login', 'google', 'https://accounts.google.com', 'audit-google', $1, NOW()),
              ('audit-telegram', 'telegram', 'https://oauth.telegram.org', 'audit-tg', $1, NOW())`,
      [person],
    );
    await pool.query(
      `INSERT INTO session (id, token, user_id, expires_at, updated_at)
       VALUES ('audit-session', 'audit-session-token', $1, NOW() + interval '1 hour', NOW())`,
      [person],
    );
    await pool.query(
      `INSERT INTO oauth_client (id, client_id, name, reference_id, redirect_uris, client_secret)
       VALUES ('audit-client-row', $1, 'Audit client', 'polinetwork',
               ARRAY['https://example.invalid/callback'], 'test-secret-never-in-audit')`,
      [clientId],
    );
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM "user" WHERE id IN ($1, $2)`, [person, root]);
    await pool.query(`DELETE FROM oauth_client WHERE client_id = $1`, [clientId]);
    await pool.end();
    const { db } = await import("../db");
    await db.$client.end();
  });

  it("audits links and client changes without secrets, and revokes sessions on deletion", async () => {
    const { auth } = await import("./index");
    await auth.$context;
    const { disconnectAccount } = await import("./accounts");
    const { updateOidcClient } = await import("./oidc-registry");
    const { deleteUser } = await import("./user-deletion");

    await disconnectAccount(person, "audit-telegram");
    expect(await updateOidcClient(root!, clientId, { disabled: true })).toMatchObject({
      disabled: true,
    });
    const rolledBack = await pool.connect();
    try {
      await rolledBack.query("BEGIN");
      await rolledBack.query(`UPDATE oauth_client SET disabled = false WHERE client_id = $1`, [
        clientId,
      ]);
      await rolledBack.query("ROLLBACK");
    } finally {
      rolledBack.release();
    }
    if (process.env.OAUTH_BACKEND_RESOURCE_URI) {
      await pool.query(
        `INSERT INTO oauth_client_resource (id, client_id, resource_id)
         VALUES ($1, $2, $3)`,
        [`audit-resource-${suffix}`, clientId, process.env.OAUTH_BACKEND_RESOURCE_URI],
      );
    }
    const before = await pool.query<{
      actor_id: string;
      operation: string;
      before: unknown;
      after: unknown;
    }>(
      `SELECT actor_id, operation, before, after FROM rbac_audit_event
       WHERE target_id IN ($1, $2) ORDER BY "createdAt"`,
      [person, clientId],
    );
    expect(before.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ actor_id: person, operation: "telegram.link" }),
        expect.objectContaining({ actor_id: person, operation: "telegram.unlink" }),
        expect.objectContaining({ actor_id: root, operation: "oidc-client.update" }),
        ...(process.env.OAUTH_BACKEND_RESOURCE_URI
          ? [expect.objectContaining({ operation: "oidc-client.resource-link" })]
          : []),
      ]),
    );
    expect(before.rows.filter((row) => row.operation === "oidc-client.update")).toHaveLength(1);
    expect(JSON.stringify(before.rows)).not.toContain("test-secret-never-in-audit");

    await deleteUser(root!, person, "Audit User");
    expect((await pool.query(`SELECT id FROM "user" WHERE id = $1`, [person])).rows).toEqual([]);
    expect((await pool.query(`SELECT id FROM session WHERE id = 'audit-session'`)).rows).toEqual(
      [],
    );
    expect(
      (await pool.query(`SELECT operation FROM rbac_audit_event WHERE target_id = $1`, [person]))
        .rows,
    ).toEqual(expect.arrayContaining([expect.objectContaining({ operation: "user.delete" })]));
  });
});
