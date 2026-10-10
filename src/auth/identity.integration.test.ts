import { createHash, createHmac } from "node:crypto";
import { exportJWK, generateKeyPair } from "jose";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { CLIENT_PRESETS } from "./client-presets";
import { AUTH_COOKIE_PREFIX } from "./cookies";
import { emptyClientDraft, type OidcClientDraft } from "./oidc-clients";
import type { ServerFnCall } from "./server-fn-harness";

// The app's own pages talk to it through server functions, which have no stable URL to fetch.
// Those tests call them in this process instead, through the harness (CSRF check, middleware,
// validator and handler), with the same signed session cookies and the same database.
vi.mock("@tanstack/react-start", async (importOriginal) =>
  (await import("./server-fn-harness")).mockReactStart(await importOriginal()),
);
vi.mock(
  "@tanstack/react-start/server",
  async () => (await import("./server-fn-harness")).startServerMock,
);

const baseURL = process.env.IDENTITY_TEST_URL;
const databaseURL = process.env.IDENTITY_TEST_DATABASE_URL;
const secret = process.env.IDENTITY_TEST_SECRET;
const adminUserId = process.env.IDENTITY_TEST_ADMIN_USER_ID;

function sessionHeaders(token: string) {
  return {
    Cookie: `${AUTH_COOKIE_PREFIX}.session_token=${encodeURIComponent(
      `${token}.${createHmac("sha256", secret ?? "unused")
        .update(token)
        .digest("base64")}`,
    )}`,
    Origin: baseURL ?? "http://localhost",
    "Content-Type": "application/json",
  };
}

/** A complete application form, as the browser submits it. */
function clientDraft(overrides: Partial<OidcClientDraft>): OidcClientDraft {
  return {
    ...emptyClientDraft(),
    redirectUris: ["https://example.invalid/callback"],
    ...overrides,
  };
}

function presetDraft(id: string, overrides: Partial<OidcClientDraft>): OidcClientDraft {
  const preset = CLIENT_PRESETS.find((candidate) => candidate.id === id)!;
  return clientDraft({ ...preset.draft, ...overrides });
}

describe.skipIf(!baseURL || !databaseURL || !secret)("identity HTTP integration", () => {
  const pool = new Pool({ connectionString: databaseURL });
  let usedInternalApi = false;
  const token = "identity-integration-session";
  const headers = sessionHeaders(token);
  beforeAll(async () => {
    await pool.query(
      `INSERT INTO "user" (id, name, email) VALUES
        ('integration-user', 'Test', 'test@identity.invalid'),
        ('permission-reader', 'Permission Reader', 'permission-reader@identity.invalid'),
        ('application-reader', 'Application Reader', 'application-reader@identity.invalid'),
        ('application-writer', 'Application Writer', 'application-writer@identity.invalid')`,
    );
    if (adminUserId)
      await pool.query(`INSERT INTO "user" (id, name, email) VALUES ($1, 'Test Admin', $2)`, [
        adminUserId,
        `${adminUserId}@identity.invalid`,
      ]);
    await pool.query(
      `INSERT INTO session (id, token, user_id, expires_at, updated_at) VALUES
        ('integration-session', $1, 'integration-user', NOW() + interval '1 hour', NOW()),
        ('permission-reader-session', 'permission-reader-session', 'permission-reader', NOW() + interval '1 hour', NOW()),
        ('application-reader-session', 'application-reader-session', 'application-reader', NOW() + interval '1 hour', NOW()),
        ('application-writer-session', 'application-writer-session', 'application-writer', NOW() + interval '1 hour', NOW())`,
      [token],
    );
    if (adminUserId)
      await pool.query(
        `INSERT INTO session (id, token, user_id, expires_at, updated_at) VALUES
         ('integration-master-session', 'integration-master-session', $1, NOW() + interval '1 hour', NOW())`,
        [adminUserId],
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
  /** Calls a server function in this process, signed in with the session `token`. */
  async function callAs<TData, TResult>(
    token: string,
    fn: (opts: { data: TData }) => Promise<TResult>,
    data: TData,
  ): Promise<ServerFnCall<TResult>> {
    usedInternalApi = true;
    const { callServerFn } = await import("./server-fn-harness");
    return callServerFn(fn, { headers: sessionHeaders(token), data });
  }
  afterAll(async () => {
    await pool.query(
      `DELETE FROM "user" WHERE id IN ('integration-user', 'permission-reader', 'application-reader', 'application-writer')`,
    );
    if (adminUserId) await pool.query(`DELETE FROM "user" WHERE id = $1`, [adminUserId]);
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
  it("advertises only the configured OAuth grants", async () => {
    const response = await fetch(`${baseURL}/api/auth/.well-known/openid-configuration`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      issuer: `${baseURL}/api/auth`,
      grant_types_supported:
        process.env.OAUTH_BACKEND_RESOURCE_URI && process.env.OAUTH_INTERNAL_RESOURCE_URI
          ? ["authorization_code", "refresh_token", "client_credentials"]
          : ["authorization_code", "refresh_token"],
    });
  });
  it.skipIf(!process.env.OAUTH_BACKEND_RESOURCE_URI || !process.env.OAUTH_INTERNAL_RESOURCE_URI)(
    "seeds the two configured resources with their scope ceilings and TTLs",
    async () => {
      const { rows } = await pool.query<{
        identifier: string;
        access_token_ttl: number;
        refresh_token_ttl: number | null;
        allowed_scopes: string[];
      }>(
        `SELECT identifier, access_token_ttl, refresh_token_ttl, allowed_scopes
         FROM oauth_resource WHERE identifier = ANY($1::text[]) ORDER BY identifier`,
        [[process.env.OAUTH_BACKEND_RESOURCE_URI, process.env.OAUTH_INTERNAL_RESOURCE_URI]],
      );
      expect(rows).toEqual([
        {
          identifier: process.env.OAUTH_INTERNAL_RESOURCE_URI,
          access_token_ttl: 300,
          refresh_token_ttl: null,
          allowed_scopes: ["idp:access:read"],
        },
        {
          identifier: process.env.OAUTH_BACKEND_RESOURCE_URI,
          access_token_ttl: 3600,
          refresh_token_ttl: 604800,
          allowed_scopes: [
            "openid",
            "profile",
            "email",
            "offline_access",
            "backend:admin",
            "backend:public:read",
            "backend:tg:read",
            "backend:tg:ingest",
            "backend:tg:groups:sync",
            "backend:tg:audit",
            "backend:tg:act-as",
            "backend:tg:events",
          ],
        },
      ]);
    },
  );
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
    const { getCatalog, getRoleMembers } = await import("./rbac.functions");
    const response = await callAs("permission-reader-session", getCatalog, undefined);
    expect(response.status).toBe(200);
    expect(response.result).toMatchObject({
      roles: [],
      permissions: expect.arrayContaining([
        expect.objectContaining({ key: "idp:permissions:read" }),
      ]),
    });

    const members = await callAs("permission-reader-session", getRoleMembers, {
      roleId: "integration-permission-reader-role",
    });
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
  it.skipIf(!process.env.OAUTH_BACKEND_RESOURCE_URI || !process.env.OAUTH_INTERNAL_RESOURCE_URI)(
    "keeps API access unavailable to an ordinary application writer",
    async () => {
      const service = await fetch(`${baseURL}/api/auth/oauth2/create-client`, {
        method: "POST",
        headers: sessionHeaders("application-writer-session"),
        body: JSON.stringify({
          client_name: "Unauthorized service",
          grant_types: ["client_credentials"],
          token_endpoint_auth_method: "client_secret_basic",
          client_credentials_scopes: ["backend:tg:ingest"],
        }),
      });
      expect(service.status).toBe(401);
      const response = await fetch(`${baseURL}/api/auth/oauth2/create-client`, {
        method: "POST",
        headers: sessionHeaders("application-writer-session"),
        body: JSON.stringify({
          client_name: "Unauthorized service",
          redirect_uris: ["https://example.invalid/callback"],
          token_endpoint_auth_method: "client_secret_basic",
        }),
      });
      expect(response.status).toBe(201);
      const { rows } = await pool.query<{ client_id: string; scopes: string[] }>(
        `SELECT client_id, scopes FROM oauth_client WHERE name = 'Unauthorized service'`,
      );
      try {
        expect(rows).toHaveLength(1);
        const clientId = rows[0]!.client_id;
        usedInternalApi = true;
        const { auth } = await import("./index");
        const promote = await fetch(`${baseURL}/api/auth/oauth2/update-client`, {
          method: "POST",
          headers: sessionHeaders("application-writer-session"),
          body: JSON.stringify({
            client_id: clientId,
            update: { scope: "openid backend:tg:ingest" },
          }),
        });
        expect(promote.status).toBe(401);
        await expect(
          auth.api.adminUpdateOAuthClient({
            headers: new Headers(sessionHeaders("application-writer-session")),
            body: {
              client_id: clientId,
              update: { client_credentials_scopes: ["backend:tg:ingest"] },
            },
          }),
        ).rejects.toMatchObject({ status: "UNAUTHORIZED" });
        const { updateOidcClientFn } = await import("./oidc.functions");
        const viaForm = await callAs("application-writer-session", updateOidcClientFn, {
          clientId,
          draft: clientDraft({
            name: "Unauthorized service",
            apiScopes: ["backend:public:read"],
            resources: ["backend"],
          }),
        });
        expect(viaForm.status).toBe(403);
        const { rows: after } = await pool.query<{
          scopes: string[];
          client_credentials_scopes: string[];
        }>(`SELECT scopes, client_credentials_scopes FROM oauth_client WHERE client_id = $1`, [
          clientId,
        ]);
        expect(after[0]?.scopes).toEqual(rows[0]?.scopes);
        expect(after[0]?.client_credentials_scopes).toEqual([]);
        expect(
          (
            await pool.query(`SELECT id FROM oauth_client_resource WHERE client_id = $1`, [
              clientId,
            ])
          ).rows,
        ).toHaveLength(0);
      } finally {
        await pool.query(`DELETE FROM oauth_client WHERE name = 'Unauthorized service'`);
      }
    },
  );
  it("denies every built-in client mutation to a read-only application administrator", async () => {
    const { getOidcClients, updateOidcClientFn } = await import("./oidc.functions");
    const readHeaders = sessionHeaders("application-reader-session");
    expect((await callAs("application-reader-session", getOidcClients, undefined)).status).toBe(
      200,
    );
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
    const response = await callAs("application-reader-session", updateOidcClientFn, {
      clientId: "integration-foreign-client",
      disabled: true,
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
    const backendResource = process.env.OAUTH_BACKEND_RESOURCE_URI;
    if (backendResource)
      await expect(
        auth.api.adminLinkClientResource({
          headers: new Headers(sessionHeaders("application-writer-session")),
          params: { identifier: backendResource, client_id: "integration-foreign-client" },
        }),
      ).rejects.toMatchObject({ status: "UNAUTHORIZED" });
  });
  it.skipIf(!adminUserId || !process.env.OAUTH_BACKEND_RESOURCE_URI)(
    "lets Master Admin link and unlink a configured resource without editing its policy",
    async () => {
      usedInternalApi = true;
      const { auth } = await import("./index");
      const identifier = process.env.OAUTH_BACKEND_RESOURCE_URI!;
      const client_id = "integration-foreign-client";
      const masterHeaders = new Headers(sessionHeaders("integration-master-session"));
      try {
        await expect(
          auth.api.adminLinkClientResource({
            headers: masterHeaders,
            params: { identifier, client_id },
          }),
        ).resolves.toMatchObject({ linked: true });
        expect(
          (
            await pool.query(
              `SELECT client_id FROM oauth_client_resource WHERE client_id = $1 AND resource_id = $2`,
              [client_id, identifier],
            )
          ).rows,
        ).toHaveLength(1);
        await expect(
          auth.api.adminCreateOAuthResource({
            headers: masterHeaders,
            body: { identifier: "https://example.invalid/forbidden-resource" },
          }),
        ).rejects.toMatchObject({ status: "UNAUTHORIZED" });
        await expect(
          auth.api.adminUnlinkClientResource({
            headers: masterHeaders,
            params: { identifier, client_id },
          }),
        ).resolves.toMatchObject({ unlinked: true });
      } finally {
        await pool.query(
          `DELETE FROM oauth_client_resource WHERE client_id = $1 AND resource_id = $2`,
          [client_id, identifier],
        );
      }
    },
  );
  it.skipIf(!adminUserId || !process.env.OAUTH_BACKEND_RESOURCE_URI)(
    "links and unlinks resources only when Master Admin saves an application",
    async () => {
      const { updateOidcClientFn } = await import("./oidc.functions");
      const resource = process.env.OAUTH_BACKEND_RESOURCE_URI!;
      await pool.query(
        `INSERT INTO oauth_client (id, client_id, name, reference_id, redirect_uris, scopes,
                                   grant_types, response_types, token_endpoint_auth_method, client_secret)
         VALUES ('integration-service-client', 'integration-service-client', 'Service',
                 'polinetwork', ARRAY['https://example.invalid/callback'], ARRAY['openid'],
                 ARRAY['authorization_code'], ARRAY['code'], 'client_secret_basic', 'unused')`,
      );
      const withApi = clientDraft({
        name: "Service",
        apiScopes: ["backend:public:read"],
        resources: ["backend"],
      });
      const save = (token: string, clientId: string, draft = withApi) =>
        callAs(token, updateOidcClientFn, { clientId, draft });
      const links = async () =>
        (
          await pool.query(
            `SELECT resource_id FROM oauth_client_resource WHERE client_id = 'integration-service-client'`,
          )
        ).rows;
      try {
        expect(
          (await save("application-writer-session", "integration-service-client")).status,
        ).toBe(403);
        expect(
          (await save("integration-master-session", "integration-foreign-client")).status,
        ).toBe(404);
        const linked = await save("integration-master-session", "integration-service-client");
        expect(linked.status).toBe(200);
        expect(linked.result?.client).toMatchObject({ restricted: true, resources: ["backend"] });
        expect(await links()).toEqual([{ resource_id: resource }]);
        expect(
          (
            await pool.query<{ actor_id: string }>(
              `SELECT actor_id FROM rbac_audit_event WHERE target_id = 'integration-service-client' AND operation = 'oidc-client.resource-link'`,
            )
          ).rows[0]?.actor_id,
        ).toBe(adminUserId);
        // A writer may not touch it now, and Master Admin can take the access back.
        expect(
          (
            await save(
              "application-writer-session",
              "integration-service-client",
              clientDraft({ name: "Service" }),
            )
          ).status,
        ).toBe(403);
        const unlinked = await save(
          "integration-master-session",
          "integration-service-client",
          clientDraft({ name: "Service" }),
        );
        expect(unlinked.result?.client).toMatchObject({ restricted: false, resources: [] });
        expect(await links()).toEqual([]);
        expect(
          (
            await save(
              "application-writer-session",
              "integration-service-client",
              clientDraft({ name: "Service renamed" }),
            )
          ).status,
        ).toBe(200);
      } finally {
        await pool.query(`DELETE FROM oauth_client WHERE id = 'integration-service-client'`);
      }
    },
  );
  it.skipIf(!adminUserId || !process.env.OAUTH_INTERNAL_RESOURCE_URI)(
    "registers a private-key service client with an isolated public key and internal resource",
    async () => {
      const { createOidcClientFn, updateOidcClientFn } = await import("./oidc.functions");
      const pair = await generateKeyPair("EdDSA", { crv: "Ed25519", extractable: true });
      const jwks = { keys: [{ ...(await exportJWK(pair.publicKey)), kid: "integration-service" }] };
      const backend = presetDraft("backend", { jwks: JSON.stringify(jwks) });
      const register = (token: string) => callAs(token, createOidcClientFn, { draft: backend });
      expect((await register("application-writer-session")).status).toBe(403);
      const response = await register("integration-master-session");
      expect(response.status).toBe(200);
      const created = response.result!;
      try {
        expect(created).toMatchObject({ linked: true, clientSecret: null });
        const { rows } = await pool.query<{
          token_endpoint_auth_method: string;
          client_credentials_scopes: string[];
          client_secret: string | null;
        }>(
          `SELECT token_endpoint_auth_method, client_credentials_scopes, client_secret
           FROM oauth_client WHERE client_id = $1`,
          [created.clientId],
        );
        expect(rows[0]).toMatchObject({
          token_endpoint_auth_method: "private_key_jwt",
          client_credentials_scopes: ["idp:access:read"],
          client_secret: null,
        });
        const writerDelete = await fetch(`${baseURL}/api/auth/oauth2/delete-client`, {
          method: "POST",
          headers: sessionHeaders("application-writer-session"),
          body: JSON.stringify({ client_id: created.clientId }),
        });
        expect(writerDelete.status).toBe(401);
        const writerUpdate = await callAs("application-writer-session", updateOidcClientFn, {
          clientId: created.clientId,
          disabled: true,
        });
        expect(writerUpdate.status).toBe(403);
        const replacement = await generateKeyPair("EdDSA", { crv: "Ed25519", extractable: true });
        const rotatedJwks = {
          keys: [jwks.keys[0], { ...(await exportJWK(replacement.publicKey)), kid: "replacement" }],
        };
        const updateKeys = (token: string, keys: { keys: Record<string, unknown>[] }) =>
          callAs(token, updateOidcClientFn, {
            clientId: created.clientId,
            draft: { ...backend, jwks: JSON.stringify(keys) },
          });
        expect((await updateKeys("application-writer-session", rotatedJwks)).status).toBe(403);
        expect((await updateKeys("integration-master-session", rotatedJwks)).status).toBe(200);
        expect(
          (
            await pool.query<{ jwks: string }>(
              `SELECT jwks FROM oauth_client WHERE client_id = $1`,
              [created.clientId],
            )
          ).rows[0]?.jwks,
        ).toEqual(JSON.stringify(rotatedJwks));
        expect(
          (
            await pool.query<{ actor_id: string }>(
              `SELECT actor_id FROM rbac_audit_event WHERE target_id = $1 AND operation = 'oidc-client.update' ORDER BY "createdAt" DESC LIMIT 1`,
              [created.clientId],
            )
          ).rows[0]?.actor_id,
        ).toBe(adminUserId);
        expect(
          (
            await updateKeys("integration-master-session", {
              keys: [{ ...(await exportJWK(replacement.privateKey)), kid: "private" }],
            })
          ).status,
        ).toBe(400);
        expect(
          (
            await pool.query(
              `SELECT id FROM oauth_client_resource WHERE client_id = $1 AND resource_id = $2`,
              [created.clientId, process.env.OAUTH_INTERNAL_RESOURCE_URI],
            )
          ).rows,
        ).toHaveLength(1);
        expect((await register("integration-master-session")).status).toBe(409);
      } finally {
        await pool.query(`DELETE FROM oauth_client WHERE client_id = $1`, [created.clientId]);
      }
    },
  );
  it.skipIf(!adminUserId || !process.env.OAUTH_BACKEND_RESOURCE_URI)(
    "applies the three backend-client presets with separate keys and resource links",
    async () => {
      const { createOidcClientFn } = await import("./oidc.functions");
      for (const [kind, expectedScopes, expectedGrants] of [
        [
          "telegram-bot",
          "backend:tg:read backend:tg:ingest backend:tg:groups:sync backend:tg:audit backend:tg:act-as backend:tg:events",
          ["client_credentials"],
        ],
        ["website", "backend:public:read", ["client_credentials"]],
        [
          "admin-dashboard",
          "openid profile email offline_access backend:admin",
          ["authorization_code", "refresh_token"],
        ],
      ] as const) {
        const pair = await generateKeyPair("EdDSA", { crv: "Ed25519", extractable: true });
        const response = await callAs("integration-master-session", createOidcClientFn, {
          draft: presetDraft(kind, {
            jwks: JSON.stringify({ keys: [{ ...(await exportJWK(pair.publicKey)), kid: kind }] }),
            redirectUris: ["https://dashboard.example.invalid/callback"],
          }),
        });
        expect(response.status).toBe(200);
        const created = response.result!;
        try {
          expect(created.linked).toBe(true);
          const { rows } = await pool.query<{
            scopes: string[];
            client_credentials_scopes: string[];
            grant_types: string[];
            enable_end_session: boolean | null;
            redirect_uris: string[];
          }>(
            `SELECT scopes, client_credentials_scopes, grant_types, enable_end_session, redirect_uris
             FROM oauth_client WHERE client_id = $1`,
            [created.clientId],
          );
          expect(rows[0]?.grant_types).toEqual(expectedGrants);
          expect(rows[0]?.scopes).toEqual(expectedScopes.split(" "));
          expect(rows[0]?.client_credentials_scopes).toEqual(
            kind === "admin-dashboard" ? [] : expectedScopes.split(" "),
          );
          expect(rows[0]?.redirect_uris).toEqual(
            kind === "admin-dashboard" ? ["https://dashboard.example.invalid/callback"] : [],
          );
          if (kind === "admin-dashboard") expect(rows[0]?.enable_end_session).toBe(true);
          expect(
            (
              await pool.query(
                `SELECT id FROM oauth_client_resource WHERE client_id = $1 AND resource_id = $2`,
                [created.clientId, process.env.OAUTH_BACKEND_RESOURCE_URI],
              )
            ).rows,
          ).toHaveLength(1);
        } finally {
          await pool.query(`DELETE FROM oauth_client WHERE client_id = $1`, [created.clientId]);
        }
      }
    },
  );
  it("lets an application writer switch a client between secret, private key, and public", async () => {
    const { createOidcClientFn, updateOidcClientFn } = await import("./oidc.functions");
    const created = await callAs("application-writer-session", createOidcClientFn, {
      draft: clientDraft({ name: "Switching app" }),
    });
    expect(created.status).toBe(200);
    const { clientId, clientSecret } = created.result!;
    expect(clientSecret).toEqual(expect.any(String));
    const stored = async () =>
      (
        await pool.query<{
          name: string;
          token_endpoint_auth_method: string;
          client_secret: string | null;
          jwks: string | null;
          redirect_uris: string[];
        }>(
          `SELECT name, token_endpoint_auth_method, client_secret, jwks, redirect_uris
           FROM oauth_client WHERE client_id = $1`,
          [clientId],
        )
      ).rows[0];
    const save = (draft: ReturnType<typeof clientDraft>) =>
      callAs("application-writer-session", updateOidcClientFn, { clientId, draft });
    try {
      const pair = await generateKeyPair("EdDSA", { crv: "Ed25519", extractable: true });
      const jwks = JSON.stringify({ keys: [{ ...(await exportJWK(pair.publicKey)), kid: "sso" }] });
      const toKey = await save(
        clientDraft({
          name: "Switching app",
          credential: "private-key",
          jwks,
          redirectUris: ["https://example.invalid/new-callback"],
        }),
      );
      expect(toKey.status).toBe(200);
      expect(toKey.result).toMatchObject({ clientSecret: null, secretPending: false });
      expect(await stored()).toMatchObject({
        token_endpoint_auth_method: "private_key_jwt",
        client_secret: null,
        jwks: JSON.stringify(JSON.parse(jwks)),
        redirect_uris: ["https://example.invalid/new-callback"],
      });
      const toPublic = await save(clientDraft({ name: "Public app", credential: "public" }));
      expect(toPublic.status).toBe(200);
      expect(await stored()).toMatchObject({
        name: "Public app",
        token_endpoint_auth_method: "none",
        client_secret: null,
        jwks: null,
      });
      const toSecret = await save(clientDraft({ name: "Public app", credential: "secret" }));
      expect(toSecret.status).toBe(200);
      const issued = toSecret.result!.clientSecret;
      expect(issued).toEqual(expect.any(String));
      const row = await stored();
      expect(row?.token_endpoint_auth_method).toBe("client_secret_basic");
      expect(row?.client_secret).toBe(createHash("sha256").update(issued!).digest("base64url"));
    } finally {
      await pool.query(`DELETE FROM oauth_client WHERE client_id = $1`, [clientId]);
    }
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
  it("prevents a numeric Telegram ID from belonging to two evidence rows", async () => {
    await expect(
      pool.query(
        `INSERT INTO identity_evidence (issuer, subject, provider_id, states, valid_until, telegram_id)
         VALUES ('https://oauth.telegram.org', 'duplicate-telegram-subject', 'telegram', '{}', NOW() + interval '1 hour', '123456')`,
      ),
    ).rejects.toThrow();
  });
  it("reclaims orphaned Telegram proof but keeps a linked ID exclusive", async () => {
    usedInternalApi = true;
    const { persistVerifiedEvidence } = await import("./providers");
    const issuer = "https://oauth.telegram.org";
    const telegramId = "777777";
    const proof = (subject: string) => ({
      issuer,
      subject,
      providerId: "telegram",
      states: [],
      validUntil: new Date(Date.now() + 3_600_000),
      telegramId,
    });
    await pool.query(
      `INSERT INTO identity_evidence (issuer, subject, provider_id, states, valid_until, telegram_id)
       VALUES ($1, 'orphaned-telegram', 'telegram', '{}', NOW() + interval '1 hour', $2)`,
      [issuer, telegramId],
    );
    try {
      await persistVerifiedEvidence(proof("relinked-telegram"));
      expect(
        (
          await pool.query(
            `SELECT subject FROM identity_evidence WHERE issuer = $1 AND telegram_id = $2`,
            [issuer, telegramId],
          )
        ).rows,
      ).toEqual([{ subject: "relinked-telegram" }]);
      await pool.query(
        `INSERT INTO account (id, provider_id, issuer, account_id, user_id, updated_at)
         VALUES ('integration-relinked-telegram', 'telegram', $1, 'relinked-telegram', 'integration-user', NOW())`,
        [issuer],
      );
      await expect(persistVerifiedEvidence(proof("attempted-telegram"))).rejects.toThrow();
      expect(
        (
          await pool.query(
            `SELECT subject FROM identity_evidence WHERE issuer = $1 AND telegram_id = $2`,
            [issuer, telegramId],
          )
        ).rows,
      ).toEqual([{ subject: "relinked-telegram" }]);
    } finally {
      await pool.query(`DELETE FROM account WHERE id = 'integration-relinked-telegram'`);
      await pool.query(`DELETE FROM identity_evidence WHERE issuer = $1 AND telegram_id = $2`, [
        issuer,
        telegramId,
      ]);
    }
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
    const { confirmStudentVerificationFn } = await import("./account.functions");
    const response = await callAs(token, confirmStudentVerificationFn, { email, code });
    expect(response.status).toBe(200);
    expect(await (await fetch(`${baseURL}/api/identity`, { headers })).json()).toEqual({
      states: ["student"],
      roles: ["student"],
      permissions: ["student:verified"],
      telegramId: "123456",
    });
  });
  it("removes identity evidence on unlink and protects the last login method", async () => {
    const { unlinkAccountFn } = await import("./account.functions");
    const unlink = (accountId: string) => callAs(token, unlinkAccountFn, { accountId });
    expect((await unlink("integration-pn")).status).toBe(200);
    expect(await (await fetch(`${baseURL}/api/identity`, { headers })).json()).toEqual({
      states: ["student"],
      roles: ["student"],
      permissions: ["student:verified"],
      telegramId: "123456",
    });
    expect((await unlink("integration-tg")).status).toBe(200);
    expect(
      (
        await pool.query(
          `SELECT subject FROM identity_evidence WHERE issuer = 'https://oauth.telegram.org' AND subject = 'tg-subject'`,
        )
      ).rows,
    ).toHaveLength(0);
    expect((await unlink("integration-google")).status).toBe(400);
  });
});
