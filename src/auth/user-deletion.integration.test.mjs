import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const TENANT = "11111111-1111-4111-8111-111111111111";
const ENTRA_ISSUER = `https://login.microsoftonline.com/${TENANT}/v2.0`;
const mocks = vi.hoisted(() => ({
  graph: vi.fn(),
  states: vi.fn(),
  list: vi.fn(),
  deleteSessions: vi.fn(),
}));
vi.mock("../env", () => {
  const url = new URL(
    process.env.RBAC_TEST_DATABASE_URL ??
      "postgresql://postgres:test@localhost:55439/auth_security",
  );
  return {
    env: {
      DB_HOST: url.hostname,
      DB_PORT: Number(url.port),
      DB_USER: url.username,
      DB_PASS: url.password,
      DB_NAME: url.pathname.slice(1),
      BETTER_AUTH_URL: "http://localhost:35439",
      BETTER_AUTH_SECRET: "test-only-secret-with-at-least-32-characters",
      IDP_ADMIN_USER_IDS: ["deletion-root", "deletion-root-2"],
      PN_ENTRA_TENANT_ID: "11111111-1111-4111-8111-111111111111",
      PN_ENTRA_MEMBER_GROUP_ID: "soci",
      PN_ENTRA_OIDC_ADMIN_GROUP_ID: "admins",
    },
  };
});
vi.mock("./membership", () => ({
  checkEntraGroupMember: mocks.graph,
  checkPnGroupStates: mocks.states,
  listEntraGroupMembers: mocks.list,
}));
// Only session authentication and Better Auth's session revocation are substituted; server
// functions, authorization, SQL and transactions are real.
vi.mock("./index", () => ({
  auth: {
    $context: Promise.resolve({ internalAdapter: { deleteSessions: mocks.deleteSessions } }),
    api: {
      getSession: async ({ headers }) => {
        const id = headers.get("x-test-user");
        return id ? { user: { id } } : null;
      },
    },
  },
}));
// Server functions run through the harness: CSRF check, middleware, validator and handler.
vi.mock("@tanstack/react-start", async (importOriginal) =>
  (await import("./server-fn-harness")).mockReactStart(await importOriginal()),
);
vi.mock(
  "@tanstack/react-start/server",
  async () => (await import("./server-fn-harness")).startServerMock,
);

import { db } from "../db/index";
import { assignRole, saveRole } from "./rbac-store";
import { deleteUser } from "./user-deletion";
import { callServerFn } from "./server-fn-harness";
import { deleteUserFn } from "./users.functions";

const root = "deletion-root";
const ordinary = "deletion-ordinary";
const unique = (name) => `deletion-${name}-${randomUUID().slice(0, 8)}`;
const draftRole = (key, permissions = []) => ({
  key,
  name: key,
  description: "",
  permissions,
  parents: [],
});

/** Deletes `userId` through `deleteUserFn`, as `actor` (signed out when null). */
function remove(actor, userId, confirm, origin = "http://localhost:35439") {
  return callServerFn(deleteUserFn, {
    headers: { ...(actor ? { "x-test-user": actor } : {}), Origin: origin },
    data: { userId, confirm },
  });
}

describe.skipIf(!process.env.RBAC_TEST_DATABASE_URL)("account deletion with PostgreSQL", () => {
  const pool = new Pool({ connectionString: process.env.RBAC_TEST_DATABASE_URL });
  let deleter;

  async function person(name = unique("person")) {
    const id = unique("user");
    await pool.query(`INSERT INTO "user" (id, name, email) VALUES ($1, $2, $1 || '@example.org')`, [
      id,
      name,
    ]);
    return { id, name };
  }

  async function withEntra(userId) {
    const subject = `${userId}-entra`;
    await pool.query(
      `INSERT INTO account (id, account_id, provider_id, issuer, user_id, updated_at)
       VALUES ($1, $2, 'pn-entra', $3, $4, now())`,
      [randomUUID(), subject, ENTRA_ISSUER, userId],
    );
    await pool.query(
      `INSERT INTO identity_evidence (issuer, subject, provider_id, external_id, states, valid_until)
       VALUES ($1, $2, 'pn-entra', $3, '{}', now() + interval '1 day')`,
      [ENTRA_ISSUER, subject, `${userId}-oid`],
    );
    return `${userId}-oid`;
  }

  const exists = async (userId) =>
    (await pool.query(`SELECT 1 FROM "user" WHERE id = $1`, [userId])).rowCount === 1;

  beforeAll(async () => {
    await pool.query(
      `INSERT INTO "user" (id, name, email) SELECT id, id, id || '@identity.invalid' FROM unnest($1::text[]) AS id`,
      [[root, "deletion-root-2", ordinary]],
    );
    deleter = unique("deleter");
    await pool.query(
      `INSERT INTO "user" (id, name, email) VALUES ($1, $1, $1 || '@identity.invalid')`,
      [deleter],
    );
    const role = await saveRole(root, draftRole(unique("deleters"), ["idp:users:delete"]));
    await assignRole(root, role.id, deleter);
  });

  beforeEach(() => {
    mocks.graph.mockReset().mockResolvedValue(false);
    mocks.states.mockReset().mockResolvedValue([]);
    mocks.list.mockReset().mockResolvedValue(null);
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM "user" WHERE id LIKE 'deletion-%'`);
    await pool.query(`DELETE FROM role WHERE key LIKE 'deletion-%'`);
    await pool.query(`DELETE FROM identity_evidence WHERE subject LIKE 'deletion-%'`);
    await pool.query(`DELETE FROM oauth_client WHERE client_id LIKE 'deletion-%'`);
    await pool.end();
    await db.$client.end();
  });

  it("refuses anyone without the permission, in server functions and the repository", async () => {
    const target = await person();
    expect((await remove(null, target.id, target.name)).status).toBe(401);
    expect((await remove(ordinary, target.id, target.name)).status).toBe(403);
    // A cross-site request is refused before it reaches the function, even for Master Admin.
    expect((await remove(root, target.id, target.name, "https://evil.example")).status).toBe(403);
    await expect(deleteUser(ordinary, target.id, target.name)).rejects.toMatchObject({
      status: 403,
    });
    // Browsing users and managing roles are not enough.
    const browser = unique("browser");
    await pool.query(
      `INSERT INTO "user" (id, name, email) VALUES ($1, $1, $1 || '@identity.invalid')`,
      [browser],
    );
    const role = await saveRole(
      root,
      draftRole(unique("browsers"), ["idp:users:read", "idp:roles:write"]),
    );
    await assignRole(root, role.id, browser);
    await expect(deleteUser(browser, target.id, target.name)).rejects.toMatchObject({
      status: 403,
    });
    expect(await exists(target.id)).toBe(true);
  });

  it("never lets anyone delete their own account", async () => {
    await expect(deleteUser(root, root, root)).rejects.toMatchObject({ status: 400 });
    await expect(deleteUser(deleter, deleter, deleter)).rejects.toMatchObject({ status: 400 });
    expect((await remove(deleter, deleter, deleter)).status).toBe(400);
    expect(await exists(deleter)).toBe(true);
  });

  it("requires the person's name and refuses unknown people", async () => {
    const target = await person();
    await expect(deleteUser(root, target.id, "someone else")).rejects.toMatchObject({
      status: 400,
    });
    expect(await exists(target.id)).toBe(true);
    await expect(deleteUser(root, unique("missing"), "x")).rejects.toMatchObject({ status: 404 });
  });

  it("never deletes a Master Admin, even for another Master Admin", async () => {
    await expect(deleteUser(root, "deletion-root-2", "deletion-root-2")).rejects.toMatchObject({
      status: 403,
    });
    const admin = await person();
    const objectId = await withEntra(admin.id);
    mocks.graph.mockImplementation(async (groupId, id) => groupId === "admins" && id === objectId);
    await expect(deleteUser(root, admin.id, admin.name)).rejects.toMatchObject({ status: 403 });
    expect(await exists(admin.id)).toBe(true);
  });

  it("refuses when Graph cannot confirm the person's groups", async () => {
    const target = await person();
    await withEntra(target.id);
    mocks.states.mockResolvedValue(null);
    await expect(deleteUser(root, target.id, target.name)).rejects.toMatchObject({ status: 503 });
    mocks.states.mockResolvedValue([]);
    mocks.graph.mockResolvedValue(null);
    await expect(deleteUser(root, target.id, target.name)).rejects.toMatchObject({ status: 503 });
    expect(await exists(target.id)).toBe(true);
  });

  it("does not let a delegate delete someone holding access they lack", async () => {
    const moderator = await person();
    const role = await saveRole(root, draftRole(unique("moderators"), ["membership:read"]));
    await assignRole(root, role.id, moderator.id);
    await expect(deleteUser(deleter, moderator.id, moderator.name)).rejects.toMatchObject({
      status: 403,
    });
    // Group membership counts as confirmed now, not as whatever a cache last said.
    const socio = await person();
    await withEntra(socio.id);
    mocks.states.mockResolvedValue(["socio"]);
    await expect(deleteUser(deleter, socio.id, socio.name)).rejects.toMatchObject({
      status: 403,
    });
    expect(await exists(moderator.id)).toBe(true);
    expect(await exists(socio.id)).toBe(true);
    // Master Admin holds everything, so it can.
    await deleteUser(root, moderator.id, moderator.name);
    expect(await exists(moderator.id)).toBe(false);
  });

  it("removes the person and what belongs to them, but keeps shared applications", async () => {
    const target = await person();
    await withEntra(target.id);
    const telegram = `${target.id}-telegram`;
    await pool.query(
      `INSERT INTO account (id, account_id, provider_id, issuer, user_id, updated_at)
       VALUES ($1, $2, 'telegram', 'https://oauth.telegram.org', $3, now())`,
      [randomUUID(), telegram, target.id],
    );
    await pool.query(
      `INSERT INTO identity_evidence (issuer, subject, provider_id, states, valid_until, telegram_id)
       VALUES ('https://oauth.telegram.org', $1, 'telegram', '{}', now() + interval '1 day', '4242')`,
      [telegram],
    );
    const sessionToken = unique("session");
    await pool.query(
      `INSERT INTO session (id, token, user_id, expires_at, updated_at)
       VALUES ($1, $1, $2, now() + interval '1 hour', now())`,
      [sessionToken, target.id],
    );
    await pool.query(
      `INSERT INTO passkey (id, public_key, user_id, credential_id, counter, device_type, backed_up)
       VALUES ($1, 'key', $2, $1, 0, 'multiDevice', true)`,
      [randomUUID(), target.id],
    );
    const clientId = unique("client");
    await pool.query(
      `INSERT INTO oauth_client (id, client_id, redirect_uris, user_id) VALUES ($1, $1, '{}', $2)`,
      [clientId, target.id],
    );

    const response = await remove(deleter, target.id, target.name);
    expect(response.status).toBe(200);
    expect(response.result).toBeUndefined();

    const count = async (sql) => Number((await pool.query(sql, [target.id])).rows[0].count);
    expect(await exists(target.id)).toBe(false);
    expect(await count(`SELECT count(*) FROM account WHERE user_id = $1`)).toBe(0);
    expect(await count(`SELECT count(*) FROM session WHERE user_id = $1`)).toBe(0);
    // Revocation goes through the adapter so OAuth token and logout hooks run.
    expect(mocks.deleteSessions).toHaveBeenCalledWith([sessionToken]);
    expect(await count(`SELECT count(*) FROM passkey WHERE user_id = $1`)).toBe(0);
    expect(
      await count(`SELECT count(*) FROM identity_evidence WHERE subject LIKE $1 || '-%'`),
    ).toBe(0);
    const client = await pool.query(`SELECT user_id FROM oauth_client WHERE client_id = $1`, [
      clientId,
    ]);
    expect(client.rows).toEqual([{ user_id: null }]);

    const audit = await pool.query(
      `SELECT actor_id, before, after FROM rbac_audit_event WHERE operation = 'user.delete' AND target_id = $1`,
      [target.id],
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0]).toMatchObject({ actor_id: deleter, after: {} });
    expect(audit.rows[0].before.providers).toEqual(["pn-entra", "telegram"]);
    // The append-only history must not keep the personal data the deletion erased.
    const recorded = JSON.stringify(audit.rows[0].before);
    for (const personal of [target.name, "@example.org", "4242", `${target.id}-oid`])
      expect(recorded).not.toContain(personal);
  });
});
