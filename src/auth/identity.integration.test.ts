import { createHmac } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";

const baseURL = process.env.IDENTITY_TEST_URL;
const databaseURL = process.env.IDENTITY_TEST_DATABASE_URL;
const secret = process.env.IDENTITY_TEST_SECRET;

function sessionHeaders(token: string) {
  return {
    Cookie: `better-auth.session_token=${encodeURIComponent(
      `${token}.${createHmac("sha256", secret ?? "unused")
        .update(token)
        .digest("base64")}`,
    )}`,
    Origin: baseURL ?? "http://localhost",
    "Content-Type": "application/json",
  };
}

describe.skipIf(!baseURL || !databaseURL || !secret)("identity HTTP integration", () => {
  const pool = new Pool({ connectionString: databaseURL });
  let usedInternalApi = false;
  const token = "identity-integration-session";
  const headers = sessionHeaders(token);
  const permissionReaderHeaders = sessionHeaders("permission-reader-session");
  beforeAll(async () => {
    await pool.query(
      `INSERT INTO "user" (id, name, email) VALUES
        ('integration-user', 'Test', 'test@identity.invalid'),
        ('permission-reader', 'Permission Reader', 'permission-reader@identity.invalid'),
        ('application-reader', 'Application Reader', 'application-reader@identity.invalid'),
        ('application-writer', 'Application Writer', 'application-writer@identity.invalid')`,
    );
    await pool.query(
      `INSERT INTO session (id, token, user_id, expires_at, updated_at) VALUES
        ('integration-session', $1, 'integration-user', NOW() + interval '1 hour', NOW()),
        ('permission-reader-session', 'permission-reader-session', 'permission-reader', NOW() + interval '1 hour', NOW()),
        ('application-reader-session', 'application-reader-session', 'application-reader', NOW() + interval '1 hour', NOW()),
        ('application-writer-session', 'application-writer-session', 'application-writer', NOW() + interval '1 hour', NOW())`,
      [token],
    );
    for (const [id, provider, subject] of [
      ["integration-google", "google", "google-subject"],
      ["integration-pn", "pn-entra", "pn-subject"],
      ["integration-tg", "telegram", "tg-subject"],
    ]) {
      await pool.query(
        `INSERT INTO account (id, provider_id, issuer, account_id, user_id, updated_at) VALUES ($1, $2, $4, $3, 'integration-user', NOW())`,
        [id, provider, subject, provider === "telegram" ? "https://oauth.telegram.org" : provider],
      );
    }
    await pool.query(
      `INSERT INTO identity_evidence (issuer, subject, provider_id, states, valid_until, telegram_id) VALUES
        ('pn-entra', 'pn-subject', 'pn-entra', ARRAY['socio']::text[], NOW() + interval '1 hour', NULL),
        ('https://oauth.telegram.org', 'tg-subject', 'telegram', ARRAY[]::text[], NOW() + interval '1 hour', '123456')`,
    );
    await pool.query(
      `INSERT INTO role (id, key, name) VALUES
        ('integration-permission-reader-role', 'integration-permission-reader', 'Permission Reader')`,
    );
    await pool.query(
      `INSERT INTO role_permission (role_id, permission_id)
       SELECT 'integration-permission-reader-role', id
       FROM permission
       WHERE key = 'idp:permissions:read'`,
    );
    await pool.query(
      `INSERT INTO user_role (user_id, role_id)
       VALUES ('permission-reader', 'integration-permission-reader-role')`,
    );
    for (const suffix of ["reader", "writer"]) {
      await pool.query(`INSERT INTO role (id, key, name) VALUES ($1, $1, $1)`, [
        `integration-application-${suffix}-role`,
      ]);
      await pool.query(
        `INSERT INTO role_permission (role_id, permission_id) SELECT $1, id FROM permission WHERE key = $2`,
        [
          `integration-application-${suffix}-role`,
          `idp:applications:${suffix === "reader" ? "read" : "write"}`,
        ],
      );
      await pool.query(`INSERT INTO user_role (user_id, role_id) VALUES ($1, $2)`, [
        `application-${suffix}`,
        `integration-application-${suffix}-role`,
      ]);
    }
    await pool.query(
      `INSERT INTO oauth_client (id, client_id, name, reference_id, redirect_uris) VALUES ('integration-foreign-client', 'integration-foreign-client', 'Foreign', 'foreign-pool', ARRAY['https://example.com/callback'])`,
    );
  });
  afterAll(async () => {
    await pool.query(
      `DELETE FROM "user" WHERE id IN ('integration-user', 'permission-reader', 'application-reader', 'application-writer')`,
    );
    await pool.query(
      `DELETE FROM role WHERE id IN ('integration-permission-reader-role', 'integration-application-reader-role', 'integration-application-writer-role')`,
    );
    await pool.query(
      `DELETE FROM identity_evidence WHERE subject IN ('pn-subject', 'tg-subject', 'student@mail.polimi.it')`,
    );
    await pool.query(`DELETE FROM oauth_client WHERE id = 'integration-foreign-client'`);
    await pool.end();
    if (usedInternalApi) await (await import("../db/index")).db.$client.end();
  });
  it("denies anonymous identity access", async () => {
    const response = await fetch(`${baseURL}/api/identity`);
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
  });
  it("requires a session to register or list passkeys", async () => {
    for (const path of ["generate-register-options", "list-user-passkeys"]) {
      const response = await fetch(`${baseURL}/api/auth/passkey/${path}`);
      expect(response.status).toBe(401);
    }
  });
  it("offers discoverable passkey authentication without an email", async () => {
    const response = await fetch(`${baseURL}/api/auth/passkey/generate-authenticate-options`);
    expect(response.status).toBe(200);
    const options = await response.json();
    expect(options).toMatchObject({
      rpId: new URL(baseURL!).hostname,
      challenge: expect.any(String),
    });
    expect(options.allowCredentials ?? []).toEqual([]);
  });
  it("registers discoverable passkeys for the signed-in user", async () => {
    const token = `${Buffer.from('{"alg":"RS256"}').toString("base64url")}.${Buffer.from(JSON.stringify({ preferred_username: "test@polinetwork.org" })).toString("base64url")}.fixture`;
    await pool.query("UPDATE account SET id_token = $1 WHERE id = 'integration-pn'", [token]);
    const response = await fetch(`${baseURL}/api/auth/passkey/generate-register-options`, {
      headers,
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      rp: { id: new URL(baseURL!).hostname, name: "PoliNetwork Auth" },
      user: { name: "test@polinetwork.org", displayName: "test@polinetwork.org" },
      authenticatorSelection: { residentKey: "required", userVerification: "required" },
    });
  });
  it("labels existing passkeys by authenticator without changing their credentials", async () => {
    await pool.query(
      `INSERT INTO passkey (id, name, public_key, user_id, credential_id, counter, device_type, backed_up, aaguid) VALUES ('integration-passkey', 'PoliNetwork passkey', 'fixture', 'integration-user', 'integration-credential', 0, 'multiDevice', true, 'bada5566-a7aa-401f-bd96-45619a55120d')`,
    );
    const response = await fetch(`${baseURL}/api/auth/passkey/list-user-passkeys`, { headers });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "integration-passkey",
          name: "1Password",
          credentialID: "integration-credential",
        }),
      ]),
    );
  });
  it("serves discovery with authorization-code grants", async () => {
    const response = await fetch(`${baseURL}/api/auth/.well-known/openid-configuration`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      issuer: `${baseURL}/api/auth`,
      grant_types_supported: ["authorization_code", "refresh_token"],
    });
  });
  it("rejects the fabricated Entra issuer while returning linked Telegram metadata", async () => {
    const response = await fetch(`${baseURL}/api/identity`, { headers });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      states: [],
      roles: [],
      permissions: [],
      telegramId: "123456",
    });
  });
  it("does not disclose the role graph to a permissions-only reader", async () => {
    const response = await fetch(`${baseURL}/api/rbac/catalog`, {
      headers: permissionReaderHeaders,
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      roles: [],
      permissions: expect.arrayContaining([
        expect.objectContaining({ key: "idp:permissions:read" }),
      ]),
    });

    const members = await fetch(
      `${baseURL}/api/rbac/role-members?role_id=integration-permission-reader-role`,
      { headers: permissionReaderHeaders },
    );
    expect(members.status).toBe(403);
  });
  it("denies client registration to ordinary users", async () => {
    const response = await fetch(`${baseURL}/api/auth/oauth2/create-client`, {
      method: "POST",
      headers,
      body: JSON.stringify({ redirect_uris: ["http://localhost:4000/callback"] }),
    });
    expect(response.status).toBe(401);
  });
  it("denies every built-in client mutation to a read-only application administrator", async () => {
    const readHeaders = sessionHeaders("application-reader-session");
    expect((await fetch(`${baseURL}/api/oidc/clients`, { headers: readHeaders })).status).toBe(200);
    for (const [path, body] of [
      ["create-client", { redirect_uris: ["https://example.com/callback"] }],
      [
        "update-client",
        { client_id: "integration-foreign-client", update: { client_name: "Stolen" } },
      ],
      ["delete-client", { client_id: "integration-foreign-client" }],
      ["client/rotate-secret", { client_id: "integration-foreign-client" }],
    ] as const) {
      const response = await fetch(`${baseURL}/api/auth/oauth2/${path}`, {
        method: "POST",
        headers: readHeaders,
        body: JSON.stringify(body),
      });
      expect(response.status).toBe(401);
    }
    const response = await fetch(`${baseURL}/api/oidc/client-update`, {
      method: "POST",
      headers: readHeaders,
      body: JSON.stringify({ clientId: "integration-foreign-client", disabled: true }),
    });
    expect(response.status).toBe(403);
  });
  it("denies cross-pool built-in client mutation even to an application writer", async () => {
    const response = await fetch(`${baseURL}/api/auth/oauth2/delete-client`, {
      method: "POST",
      headers: sessionHeaders("application-writer-session"),
      body: JSON.stringify({ client_id: "integration-foreign-client" }),
    });
    expect(response.status).toBe(401);
    expect(
      (await pool.query(`SELECT id FROM oauth_client WHERE id = 'integration-foreign-client'`))
        .rows,
    ).toHaveLength(1);
  });
  it("denies resource-policy mutation through the server SDK to an ordinary session", async () => {
    usedInternalApi = true;
    const { auth } = await import("./index");
    await expect(
      auth.api.adminCreateOAuthResource({
        headers: new Headers(headers),
        body: { identifier: "https://example.invalid/security-resource" },
      }),
    ).rejects.toMatchObject({ status: "UNAUTHORIZED" });
  });
  it("does not expose server-only resource administration over HTTP", async () => {
    const response = await fetch(`${baseURL}/api/auth/admin/oauth2/resources`, { headers });
    expect(response.status).toBe(404);
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
      states: ["student"],
      roles: ["student"],
      permissions: ["student:verified"],
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
      roles: ["student"],
      permissions: ["student:verified"],
      telegramId: "123456",
    });
    expect((await unlink("integration-tg")).status).toBe(200);
    expect((await unlink("integration-google")).status).toBe(400);
  });
});
