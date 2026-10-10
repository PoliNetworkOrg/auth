import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";

const baseURL = process.env.ACCESS_SNAPSHOT_TEST_URL;
const databaseURL = process.env.ACCESS_SNAPSHOT_TEST_DATABASE_URL;
const clientId = process.env.OAUTH_BACKEND_CLIENT_ID;
const audience = process.env.OAUTH_INTERNAL_RESOURCE_URI;

describe.skipIf(!baseURL || !databaseURL || !clientId || !audience)(
  "access snapshot HTTP integration",
  () => {
    const pool = new Pool({ connectionString: databaseURL });
    const keyId = "snapshot-integration-key";
    let privateKey: Awaited<ReturnType<typeof generateKeyPair>>["privateKey"];

    async function token(overrides: Record<string, string> = {}) {
      return new SignJWT({
        client_id: clientId,
        azp: clientId,
        scope: "idp:access:read",
        pn_subject_type: "client",
        ...overrides,
      })
        .setProtectedHeader({ alg: "EdDSA", kid: keyId, typ: "at+jwt" })
        .setIssuer(`${baseURL}/api/auth`)
        .setAudience(audience!)
        .setSubject(overrides.client_id ?? clientId!)
        .setIssuedAt()
        .setExpirationTime("5m")
        .sign(privateKey);
    }

    async function pull(bearer: string, etag?: string) {
      return fetch(`${baseURL}/api/internal/access-snapshot`, {
        headers: { Authorization: `Bearer ${bearer}`, ...(etag ? { "If-None-Match": etag } : {}) },
      });
    }

    beforeAll(async () => {
      const pair = await generateKeyPair("EdDSA", { crv: "Ed25519", extractable: true });
      privateKey = pair.privateKey;
      const publicKey = await exportJWK(pair.publicKey);
      const privateJwk = await exportJWK(pair.privateKey);
      await pool.query(
        `INSERT INTO jwks (id, public_key, private_key, created_at, alg, crv)
         VALUES ($1, $2, $3, NOW(), 'EdDSA', 'Ed25519')`,
        [keyId, JSON.stringify(publicKey), JSON.stringify(privateJwk)],
      );
      await pool.query(
        `INSERT INTO "user" (id, name, email)
         VALUES ('snapshot-integration-user', 'Snapshot User', 'snapshot@identity.invalid')`,
      );
      await pool.query(
        `INSERT INTO permission (id, key, name)
         VALUES ('snapshot-integration-permission', 'tg:snapshot:test', 'Snapshot test')`,
      );
      await pool.query(
        `INSERT INTO role (id, key, name)
         VALUES ('snapshot-integration-role', 'snapshot-integration-role', 'Snapshot test')`,
      );
      await pool.query(
        `INSERT INTO role_permission (role_id, permission_id)
         VALUES ('snapshot-integration-role', 'snapshot-integration-permission')`,
      );
      await pool.query(
        `INSERT INTO user_role (user_id, role_id)
         VALUES ('snapshot-integration-user', 'snapshot-integration-role')`,
      );
      await pool.query(
        `INSERT INTO account (id, provider_id, issuer, account_id, user_id, updated_at)
         VALUES ('snapshot-integration-account', 'telegram', 'https://oauth.telegram.org',
                 'snapshot-tg-subject', 'snapshot-integration-user', NOW())`,
      );
      await pool.query(
        `INSERT INTO identity_evidence
           (issuer, subject, provider_id, states, valid_until, telegram_id)
         VALUES ('https://oauth.telegram.org', 'snapshot-tg-subject', 'telegram', ARRAY[]::text[],
                 NOW() - interval '1 day', '987654321')`,
      );
    });

    afterAll(async () => {
      await pool.query(`DELETE FROM "user" WHERE id = 'snapshot-integration-user'`);
      await pool.query(`DELETE FROM identity_evidence WHERE subject = 'snapshot-tg-subject'`);
      await pool.query(`DELETE FROM role WHERE id = 'snapshot-integration-role'`);
      await pool.query(`DELETE FROM permission WHERE id = 'snapshot-integration-permission'`);
      await pool.query(`DELETE FROM jwks WHERE id = $1`, [keyId]);
      await pool.end();
    });

    it("authenticates the client and keeps ETags stable until projected data changes", async () => {
      expect((await pull("invalid")).status).toBe(401);
      expect((await pull(await token({ scope: "backend:tg:read" }))).status).toBe(401);
      expect(
        (await pull(await token({ client_id: "unregistered-client", azp: "unregistered-client" })))
          .status,
      ).toBe(403);

      const validToken = await token();
      const first = await pull(validToken);
      expect(first.status).toBe(200);
      expect(first.headers.get("cache-control")).toContain("no-store");
      const etag = first.headers.get("etag");
      expect(etag).toMatch(/^"sha256-[a-f0-9]{64}"$/);
      const body = await first.json();
      expect(body).toMatchObject({
        schema: "polinetwork.access-snapshot/v1",
        projection: "backend",
        subjects: expect.arrayContaining([
          {
            sub: "snapshot-integration-user",
            telegramId: "987654321",
            permissions: { "tg:snapshot:test": { validUntil: null } },
          },
        ]),
      });
      expect(body.sources["entra:soci"]).toMatchObject({ health: "degraded", observedAt: null });

      const unchanged = await pull(validToken, etag!);
      expect(unchanged.status).toBe(304);
      expect(unchanged.headers.get("etag")).toBe(etag);

      await pool.query(`DELETE FROM account WHERE id = 'snapshot-integration-account'`);
      const unlinked = await pull(validToken, etag!);
      expect(unlinked.status).toBe(200);
      expect(unlinked.headers.get("etag")).not.toBe(etag);
      expect((await unlinked.json()).subjects).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ sub: "snapshot-integration-user", telegramId: null }),
        ]),
      );
    });
  },
);
