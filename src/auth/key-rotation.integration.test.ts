import { createLocalJWKSet, decodeProtectedHeader, jwtVerify } from "jose";
import { Pool } from "pg";
import { afterAll, describe, expect, it } from "vite-plus/test";

const databaseURL = process.env.ACCESS_SNAPSHOT_TEST_DATABASE_URL;

describe.skipIf(!databaseURL)("IdP JWT key rotation integration", () => {
  const pool = new Pool({ connectionString: databaseURL });

  afterAll(async () => {
    await pool.end();
    const { db } = await import("../db");
    await db.$client.end();
  });

  it("mints a replacement after expiry and keeps the prior public key during overlap", async () => {
    const { auth } = await import("./index");
    await auth.$context;
    const first = await auth.api.signJWT({ body: { payload: { sub: "rotation-integration" } } });
    const firstKid = decodeProtectedHeader(first.token).kid;
    expect(firstKid).toEqual(expect.any(String));
    const firstExpiry = await pool.query<{ expires_at: Date }>(
      `SELECT expires_at FROM jwks WHERE id = $1`,
      [firstKid],
    );
    expect(firstExpiry.rows[0]?.expires_at.getTime()).toBeGreaterThan(Date.now());

    await pool.query(`UPDATE jwks SET expires_at = NOW() - interval '1 second' WHERE id = $1`, [
      firstKid,
    ]);
    const second = await auth.api.signJWT({ body: { payload: { sub: "rotation-integration" } } });
    const secondKid = decodeProtectedHeader(second.token).kid;
    expect(secondKid).not.toBe(firstKid);

    const jwks = createLocalJWKSet(await auth.api.getJwks());
    for (const token of [first.token, second.token]) {
      const verified = await jwtVerify(token, jwks, { algorithms: ["EdDSA"] });
      expect(verified.payload.sub).toBe("rotation-integration");
    }
  });
});
