import { createServer, type Server } from "node:http";
import { createLocalJWKSet, jwtVerify } from "jose";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";

const databaseURL = process.env.ACCESS_SNAPSHOT_TEST_DATABASE_URL;
const endpoint = process.env.OAUTH_BACKEND_EVENTS_URL;
const audience = process.env.OAUTH_BACKEND_RESOURCE_URI;

describe.skipIf(!databaseURL || !endpoint || !audience)("access-change outbox integration", () => {
  const pool = new Pool({ connectionString: databaseURL });
  const received: string[] = [];
  let server: Server;
  let accept = false;

  beforeAll(async () => {
    const address = new URL(endpoint!);
    server = createServer(async (request, response) => {
      expect(request.method).toBe("POST");
      expect(request.headers["content-type"]).toBe("application/secevent+jwt");
      let body = "";
      for await (const chunk of request) body += chunk.toString();
      received.push(body);
      response.writeHead(accept ? 202 : 503).end();
    });
    await new Promise<void>((resolve) =>
      server.listen(Number(address.port), address.hostname, resolve),
    );
    await pool.query(`DELETE FROM entra_group_observation WHERE source = 'integration:outbox'`);
    await pool.query(`DELETE FROM access_outbox`);
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM entra_group_observation WHERE source = 'integration:outbox'`);
    await pool.query(`DELETE FROM access_outbox`);
    await pool.end();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    const { db } = await import("../db");
    await db.$client.end();
  });

  async function outbox() {
    return (
      await pool.query<{ attempts: number; id: string; due: boolean }>(
        `SELECT attempts, id::text, next_attempt_at <= NOW() AS due FROM access_outbox ORDER BY id`,
      )
    ).rows;
  }

  it("ignores rewrites that leave projected columns unchanged", async () => {
    await pool.query(
      `INSERT INTO "user" (id, name, email)
       VALUES ('outbox-integration-user', 'Outbox User', 'outbox@identity.invalid')`,
    );
    try {
      await pool.query(
        `INSERT INTO account (id, provider_id, issuer, account_id, user_id, updated_at)
         VALUES ('outbox-integration-account', 'telegram', 'https://oauth.telegram.org',
                 'outbox-tg-subject', 'outbox-integration-user', NOW())`,
      );
      await pool.query(
        `INSERT INTO identity_evidence
           (issuer, subject, provider_id, states, valid_until, telegram_id)
         VALUES ('https://oauth.telegram.org', 'outbox-tg-subject', 'telegram', ARRAY[]::text[],
                 NOW(), '123456789')`,
      );
      await pool.query(`DELETE FROM access_outbox`);

      await pool.query(
        `UPDATE account SET access_token = 'refreshed', updated_at = NOW()
         WHERE id = 'outbox-integration-account'`,
      );
      await pool.query(
        `UPDATE identity_evidence SET telegram_id = telegram_id
         WHERE subject = 'outbox-tg-subject'`,
      );
      expect(await outbox()).toHaveLength(0);

      await pool.query(
        `UPDATE identity_evidence SET valid_until = valid_until + interval '1 hour'
         WHERE subject = 'outbox-tg-subject'`,
      );
      expect(await outbox()).toHaveLength(1);
    } finally {
      await pool.query(`DELETE FROM "user" WHERE id = 'outbox-integration-user'`);
      await pool.query(`DELETE FROM identity_evidence WHERE subject = 'outbox-tg-subject'`);
      await pool.query(`DELETE FROM access_outbox`);
    }
  });

  it("coalesces changes transactionally and retries one signed event", async () => {
    const { auth } = await import("./index");
    const { dispatchAccessChanges } = await import("./access-dispatcher");
    await auth.$context;

    await pool.query(
      `INSERT INTO entra_group_observation (source, group_id, members, observed_at)
       VALUES ('integration:outbox', 'group-1', ARRAY['a']::text[], NOW())`,
    );
    expect(await outbox()).toHaveLength(1);

    await pool.query(
      `UPDATE entra_group_observation SET observed_at = NOW()
       WHERE source = 'integration:outbox'`,
    );
    await pool.query(
      `UPDATE entra_group_observation SET members = ARRAY['b']::text[]
       WHERE source = 'integration:outbox'`,
    );
    expect(await outbox()).toHaveLength(1);

    const transaction = await pool.connect();
    try {
      await transaction.query("BEGIN");
      await transaction.query(
        `INSERT INTO permission (id, key, name)
         VALUES ('outbox-rolled-back', 'tg:outbox:rolled-back', 'Rolled back')`,
      );
      await transaction.query("ROLLBACK");
    } finally {
      transaction.release();
    }
    expect(await outbox()).toHaveLength(1);

    // An open transaction's change holds the undelivered row back from the dispatcher.
    const writer = await pool.connect();
    try {
      await writer.query("BEGIN");
      await writer.query(
        `UPDATE entra_group_observation SET members = ARRAY['c']::text[]
         WHERE source = 'integration:outbox'`,
      );
      expect(await dispatchAccessChanges(auth)).toBe(false);
      await writer.query("COMMIT");
    } finally {
      writer.release();
    }
    expect(received).toHaveLength(0);

    // The dispatcher may be the first signer after a rotation; its key must still expire.
    await pool.query(
      `UPDATE jwks SET expires_at = NOW() - interval '1 second'
       WHERE expires_at IS NULL OR expires_at > NOW()`,
    );
    expect(await dispatchAccessChanges(auth)).toBe(true);
    expect(received).toHaveLength(1);
    const minted = await pool.query<{ expiring: boolean }>(
      `SELECT expires_at > NOW() AS expiring FROM jwks ORDER BY created_at DESC LIMIT 1`,
    );
    expect(minted.rows[0]?.expiring).toBe(true);
    const [retry] = await outbox();
    expect(retry).toMatchObject({ attempts: 1, due: false });

    const jwks = await auth.api.getJwks();
    const verified = await jwtVerify(received[0]!, createLocalJWKSet(jwks), {
      issuer: `${process.env.BETTER_AUTH_URL}/api/auth`,
      audience,
      algorithms: ["EdDSA"],
    });
    expect(verified.protectedHeader.typ).toBe("secevent+jwt");
    expect(verified.payload).toMatchObject({
      jti: `access-${retry!.id}`,
      events: {
        "https://schemas.polinetwork.org/events/access-changed": { projection: "backend" },
      },
    });

    // A change during backoff adds one row that waits behind the retry.
    for (const members of ["d", "e"])
      await pool.query(
        `UPDATE entra_group_observation SET members = ARRAY[$1]::text[]
         WHERE source = 'integration:outbox'`,
        [members],
      );
    expect(await outbox()).toMatchObject([
      { attempts: 1, due: false },
      { attempts: 0, due: false },
    ]);

    accept = true;
    await pool.query(`UPDATE access_outbox SET next_attempt_at = NOW()`);
    expect(await dispatchAccessChanges(auth)).toBe(true);
    expect(received).toHaveLength(2);
    expect(await outbox()).toHaveLength(0);
    const again = await jwtVerify(received[1]!, createLocalJWKSet(jwks), {
      issuer: `${process.env.BETTER_AUTH_URL}/api/auth`,
      audience,
      algorithms: ["EdDSA"],
    });
    expect(again.payload.jti).toBe(verified.payload.jti);
  });
});
