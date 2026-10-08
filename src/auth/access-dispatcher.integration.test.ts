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

  it("queues transactionally, ignores unchanged group membership, and retries a signed event", async () => {
    const { auth } = await import("./index");
    const { dispatchAccessChanges } = await import("./access-dispatcher");
    await auth.$context;

    await pool.query(
      `INSERT INTO entra_group_observation (source, group_id, members, observed_at)
       VALUES ('integration:outbox', 'group-1', ARRAY['a']::text[], NOW())`,
    );
    expect(
      (await pool.query(`SELECT count(*)::integer AS count FROM access_outbox`)).rows[0].count,
    ).toBe(1);

    await pool.query(
      `UPDATE entra_group_observation SET observed_at = NOW()
       WHERE source = 'integration:outbox'`,
    );
    expect(
      (await pool.query(`SELECT count(*)::integer AS count FROM access_outbox`)).rows[0].count,
    ).toBe(1);

    await pool.query(
      `UPDATE entra_group_observation SET members = ARRAY['b']::text[]
       WHERE source = 'integration:outbox'`,
    );
    expect(
      (await pool.query(`SELECT count(*)::integer AS count FROM access_outbox`)).rows[0].count,
    ).toBe(2);

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
    expect(
      (await pool.query(`SELECT count(*)::integer AS count FROM access_outbox`)).rows[0].count,
    ).toBe(2);

    expect(await dispatchAccessChanges(auth)).toBe(true);
    expect(received).toHaveLength(1);
    const retry = await pool.query<{ attempts: number; id: string }>(
      `SELECT attempts, id::text FROM access_outbox ORDER BY id`,
    );
    expect(retry.rows.map((row) => row.attempts)).toEqual([1, 1]);

    const jwks = await auth.api.getJwks();
    const verified = await jwtVerify(received[0]!, createLocalJWKSet(jwks), {
      issuer: `${process.env.BETTER_AUTH_URL}/api/auth`,
      audience,
      algorithms: ["EdDSA"],
    });
    expect(verified.protectedHeader.typ).toBe("secevent+jwt");
    expect(verified.payload).toMatchObject({
      jti: `access-${retry.rows[0]?.id}`,
      events: {
        "https://schemas.polinetwork.org/events/access-changed": { projection: "backend" },
      },
    });

    accept = true;
    await pool.query(`UPDATE access_outbox SET next_attempt_at = NOW()`);
    expect(await dispatchAccessChanges(auth)).toBe(true);
    expect(received).toHaveLength(2);
    expect(
      (await pool.query(`SELECT count(*)::integer AS count FROM access_outbox`)).rows[0].count,
    ).toBe(0);
    const again = await jwtVerify(received[1]!, createLocalJWKSet(jwks), {
      issuer: `${process.env.BETTER_AUTH_URL}/api/auth`,
      audience,
      algorithms: ["EdDSA"],
    });
    expect(again.payload.jti).toBe(verified.payload.jti);
  });
});
