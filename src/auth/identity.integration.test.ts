import { createHmac } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";

const baseURL = process.env.IDENTITY_TEST_URL;
const databaseURL = process.env.IDENTITY_TEST_DATABASE_URL;
const secret = process.env.IDENTITY_TEST_SECRET;

describe.skipIf(!baseURL || !databaseURL || !secret)("identity HTTP integration", () => {
  const pool = new Pool({ connectionString: databaseURL });
  const token = "identity-integration-session";
  const headers = {
    Cookie: `better-auth.session_token=${encodeURIComponent(
      `${token}.${createHmac("sha256", secret ?? "unused")
        .update(token)
        .digest("base64")}`,
    )}`,
    Origin: baseURL ?? "http://localhost",
    "Content-Type": "application/json",
  };
  beforeAll(async () => {
    await pool.query(
      `INSERT INTO "user" (id, name, email) VALUES ('integration-user', 'Test', 'test@identity.invalid')`,
    );
    await pool.query(
      `INSERT INTO session (id, token, user_id, expires_at, updated_at) VALUES ('integration-session', $1, 'integration-user', NOW() + interval '1 hour', NOW())`,
      [token],
    );
    for (const [id, provider, subject] of [
      ["integration-google", "google", "google-subject"],
      ["integration-pn", "pn-entra", "pn-subject"],
      ["integration-tg", "telegram", "tg-subject"],
    ]) {
      await pool.query(
        `INSERT INTO account (id, provider_id, issuer, account_id, user_id, updated_at) VALUES ($1, $2, $2, $3, 'integration-user', NOW())`,
        [id, provider, subject],
      );
    }
    await pool.query(
      `INSERT INTO identity_evidence (issuer, subject, provider_id, state, valid_until, telegram_id) VALUES ('pn-entra', 'pn-subject', 'pn-entra', 'socio', NOW() + interval '1 hour', NULL), ('telegram', 'tg-subject', 'telegram', NULL, NOW() + interval '1 hour', '123456')`,
    );
  });
  afterAll(async () => {
    await pool.query(`DELETE FROM "user" WHERE id = 'integration-user'`);
    await pool.query(
      `DELETE FROM identity_evidence WHERE issuer IN ('pn-entra', 'telegram', 'https://mail.polimi.it')`,
    );
    await pool.end();
  });
  it("denies anonymous identity access", async () => {
    const response = await fetch(`${baseURL}/api/identity`);
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
  });
  it("serves discovery with authorization-code grants", async () => {
    const response = await fetch(`${baseURL}/api/auth/.well-known/openid-configuration`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      issuer: `${baseURL}/api/auth`,
      grant_types_supported: ["authorization_code", "refresh_token"],
    });
  });
  it("returns linked proofs but never grants Telegram moderation", async () => {
    const response = await fetch(`${baseURL}/api/identity`, { headers });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      states: ["socio"],
      permissions: ["membership:read"],
      telegramId: "123456",
    });
  });
  it("denies client registration to ordinary users", async () => {
    const response = await fetch(`${baseURL}/api/auth/oauth2/create-client`, {
      method: "POST",
      headers,
      body: JSON.stringify({ redirect_uris: ["http://localhost:4000/callback"] }),
    });
    expect(response.status).toBe(401);
  });
  it("prevents duplicate ownership of an upstream identity", async () => {
    await expect(
      pool.query(
        `INSERT INTO account (id, provider_id, issuer, account_id, user_id, updated_at) VALUES ('duplicate', 'pn-entra', 'pn-entra', 'pn-subject', 'integration-user', NOW())`,
      ),
    ).rejects.toThrow();
  });
  it("turns a valid Polimi email code into a linked student identity", async () => {
    const email = "student@mail.polimi.it";
    const code = "123456";
    const codeHash = createHmac("sha256", secret ?? "unused")
      .update(`integration-user:${email}:${code}`)
      .digest("hex");
    await pool.query(
      `INSERT INTO student_verification_challenge (user_id, email, code_hash, expires_at, last_sent_at) VALUES ('integration-user', $1, $2, NOW() + interval '10 minutes', NOW())`,
      [email, codeHash],
    );
    const response = await fetch(`${baseURL}/api/student-verification`, {
      method: "POST",
      headers,
      body: JSON.stringify({ action: "confirm", email, code }),
    });
    expect(response.status).toBe(200);
    expect(await (await fetch(`${baseURL}/api/identity`, { headers })).json()).toEqual({
      states: ["socio", "student"],
      permissions: ["membership:read", "student:verified"],
      telegramId: "123456",
    });
  });
  it("removes identity evidence on unlink and protects the last login method", async () => {
    const unlink = (accountId: string) =>
      fetch(`${baseURL}/api/accounts/unlink`, {
        method: "POST",
        headers,
        body: JSON.stringify({ accountId }),
      });
    expect((await unlink("integration-pn")).status).toBe(200);
    expect(await (await fetch(`${baseURL}/api/identity`, { headers })).json()).toEqual({
      states: ["student"],
      permissions: ["student:verified"],
      telegramId: "123456",
    });
    expect((await unlink("integration-tg")).status).toBe(200);
    expect((await unlink("integration-google")).status).toBe(400);
  });
});
