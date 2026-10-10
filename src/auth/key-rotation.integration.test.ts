import { signJWT } from "better-auth/plugins/jwt";
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
      const verified = await jwtVerify(token, jwks, { algorithms: ["RS256", "EdDSA"] });
      expect(verified.payload.sub).toBe("rotation-integration");
    }
  });

  it("keeps ID tokens on RS256 while EdDSA stays available to pinned services", async () => {
    const { auth } = await import("./index");
    const { ensureIdTokenKey, jwtOptions } = await import("./jwt-options");
    const context = { context: await auth.$context } as Parameters<typeof signJWT>[0];
    const payload = { sub: "algorithm-integration" };
    await pool.query(`UPDATE jwks SET expires_at = NOW() - interval '1 second'`);

    const pinned = await signJWT(context, {
      options: jwtOptions,
      payload,
      signingAlgorithm: "EdDSA",
    });
    expect(decodeProtectedHeader(pinned).alg).toBe("EdDSA");
    // With only an EdDSA key live, unpinned signing would fall back to it.
    await ensureIdTokenKey(context);
    const unpinned = await signJWT(context, { options: jwtOptions, payload });
    expect(decodeProtectedHeader(unpinned).alg).toBe("RS256");

    const jwks = createLocalJWKSet(await auth.api.getJwks());
    await expect(jwtVerify(pinned, jwks, { algorithms: ["EdDSA"] })).resolves.toBeDefined();
    await expect(jwtVerify(unpinned, jwks, { algorithms: ["RS256"] })).resolves.toBeDefined();
  });

  it("deletes keys only after their grace period ends", async () => {
    const { pruneRetiredKeys } = await import("./key-pruning");
    const ids = ["prune-retired", "prune-grace"];
    await pool.query(
      `INSERT INTO jwks (id, public_key, private_key, created_at, expires_at, alg, crv)
       VALUES ($1, '{}', '{}', NOW(), $3, 'EdDSA', 'Ed25519'),
              ($2, '{}', '{}', NOW(), $4, 'EdDSA', 'Ed25519')`,
      [...ids, new Date(Date.now() - 31 * 86_400_000), new Date(Date.now() - 29 * 86_400_000)],
    );
    try {
      await pruneRetiredKeys();
      const left = await pool.query<{ id: string }>(`SELECT id FROM jwks WHERE id = ANY($1)`, [
        ids,
      ]);
      expect(left.rows.map((row) => row.id)).toEqual(["prune-grace"]);
    } finally {
      await pool.query(`DELETE FROM jwks WHERE id = ANY($1)`, [ids]);
    }
  });
});
