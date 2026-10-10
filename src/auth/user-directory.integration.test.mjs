import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const TENANT = "11111111-1111-4111-8111-111111111111";
const ENTRA_ISSUER = `https://login.microsoftonline.com/${TENANT}/v2.0`;
const mocks = vi.hoisted(() => ({ graph: vi.fn(), list: vi.fn() }));
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
      IDP_ADMIN_USER_IDS: ["directory-root"],
      PN_ENTRA_TENANT_ID: "11111111-1111-4111-8111-111111111111",
      PN_ENTRA_MEMBER_GROUP_ID: "soci",
    },
  };
});
vi.mock("./membership", () => ({
  checkEntraGroupMember: mocks.graph,
  listEntraGroupMembers: mocks.list,
}));
// Only session authentication is substituted; server functions, authorization, SQL and
// transactions are real.
vi.mock("./index", () => ({
  auth: {
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
import { assignRole, saveRole, searchUsers, unassignRole } from "./rbac-store";
import { getUserDetail, listUsers } from "./user-directory";
import { getRoleMembers, searchPeople } from "./rbac.functions";
import { callServerFn } from "./server-fn-harness";
import { getUser, getUsers } from "./users.functions";

const root = "directory-root";
const ordinary = "directory-ordinary";
const unique = (name) => `directory-${name}-${randomUUID().slice(0, 8)}`;
const draftRole = (key, permissions = []) => ({
  key,
  name: key,
  description: "",
  permissions,
  parents: [],
});

/** Calls a server function from this app's pages, as `actor` (signed out when null). */
function call(fn, actor, data) {
  return callServerFn(fn, {
    headers: { ...(actor ? { "x-test-user": actor } : {}), Origin: "http://localhost:35439" },
    data,
  });
}

describe.skipIf(!process.env.RBAC_TEST_DATABASE_URL)("user directory with PostgreSQL", () => {
  const pool = new Pool({ connectionString: process.env.RBAC_TEST_DATABASE_URL });
  // Every fixture's name starts with this, so searching for it scopes a query to them.
  const tag = unique("people");
  const ada = unique("ada");
  const bruno = unique("bruno");
  const chiara = unique("chiara");
  // Outside the tagged fixtures, so the queries scoped to `tag` do not see him.
  const dario = unique("dario");
  const darioMail = `${dario}@mail.polimi.it`;
  let moderator;

  async function account(userId, providerId, issuer, accountId, idToken = null) {
    await pool.query(
      `INSERT INTO account (id, account_id, provider_id, issuer, user_id, id_token, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, now())`,
      [randomUUID(), accountId, providerId, issuer, userId, idToken],
    );
  }

  // Only the claims are read, so the header and signature are placeholders.
  const idToken = (claims) =>
    `${Buffer.from('{"alg":"RS256"}').toString("base64url")}.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.signature`;

  async function evidence(issuer, subject, providerId, fields) {
    await pool.query(
      `INSERT INTO identity_evidence (issuer, subject, provider_id, external_id, states, valid_until, telegram_id, email)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        issuer,
        subject,
        providerId,
        fields.externalId ?? null,
        fields.states ?? [],
        fields.validUntil ?? new Date(Date.now() + 86_400_000),
        fields.telegramId ?? null,
        fields.email ?? null,
      ],
    );
  }

  beforeAll(async () => {
    await pool.query(
      `INSERT INTO "user" (id, name, email) VALUES
        ($1, $1, $1 || '@identity.invalid'),
        ($2, $2, $2 || '@identity.invalid'),
        ($3, $6 || ' Ada', 'pn-entra.ada@identity.invalid'),
        ($4, $6 || ' Bruno', $4 || '@gmail.example'),
        ($5, $6 || ' Chiara', $5 || '@gmail.example')`,
      [root, ordinary, ada, bruno, chiara, tag],
    );
    // Ada: PoliNetwork account recorded as Socio, Telegram, and a current Polimi verification.
    // Her stored email is a placeholder. Her last sign-in saved her real address, which
    // wins over the older one in her saved token.
    await account(
      ada,
      "pn-entra",
      ENTRA_ISSUER,
      `${ada}-entra`,
      idToken({ preferred_username: `${ada}.old@polinetwork.example` }),
    );
    await evidence(ENTRA_ISSUER, `${ada}-entra`, "pn-entra", {
      externalId: `${ada}-oid`,
      states: ["socio"],
      email: `${ada}@polinetwork.example`,
    });
    await account(ada, "telegram", "https://oauth.telegram.org", `${ada}-telegram`);
    await evidence("https://oauth.telegram.org", `${ada}-telegram`, "telegram", {
      telegramId: "4242424242",
    });
    const adaMail = `${ada}@mail.polimi.it`;
    await account(ada, "polimi-email", "https://mail.polimi.it", adaMail);
    await evidence("https://mail.polimi.it", adaMail, "polimi-email", { states: ["student"] });
    // Bruno: Google and a passkey, with an expired Polimi verification.
    await account(bruno, "google", "https://accounts.google.com", `${bruno}-google`);
    await pool.query(
      `INSERT INTO passkey (id, public_key, user_id, credential_id, counter, device_type, backed_up)
       VALUES ($1, 'key', $2, $1, 0, 'multiDevice', true)`,
      [randomUUID(), bruno],
    );
    const brunoMail = `${bruno}@mail.polimi.it`;
    await account(bruno, "polimi-email", "https://mail.polimi.it", brunoMail);
    await evidence("https://mail.polimi.it", brunoMail, "polimi-email", {
      states: ["student"],
      validUntil: new Date(Date.now() - 1000),
    });
    // Chiara: evidence claiming Socio from an issuer this deployment does not trust.
    const otherIssuer = "https://login.microsoftonline.com/other-tenant/v2.0";
    await account(chiara, "pn-entra", otherIssuer, `${chiara}-entra`);
    await evidence(otherIssuer, `${chiara}-entra`, "pn-entra", {
      externalId: `${chiara}-oid`,
      states: ["socio"],
    });
    // Dario: Telegram and Polimi accounts from issuers those providers never use.
    await pool.query(
      `INSERT INTO "user" (id, name, email) VALUES ($1, $1, $1 || '@gmail.example')`,
      [dario],
    );
    await account(dario, "telegram", "https://telegram.example", `${dario}-telegram`);
    await evidence("https://telegram.example", `${dario}-telegram`, "telegram", {
      telegramId: "5151515151",
    });
    await account(dario, "polimi-email", "https://mail.example", darioMail);
    await evidence("https://mail.example", darioMail, "polimi-email", { states: ["student"] });
    moderator = await saveRole(root, draftRole(unique("moderator")));
    await assignRole(root, moderator.id, bruno);
  });

  beforeEach(() => {
    mocks.graph.mockReset().mockResolvedValue(false);
    mocks.list.mockReset().mockResolvedValue(null);
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM "user" WHERE id LIKE 'directory-%'`);
    await pool.query(`DELETE FROM role WHERE key LIKE 'directory-%'`);
    await pool.query(`DELETE FROM identity_evidence WHERE subject LIKE 'directory-%'`);
    await pool.end();
    await db.$client.end();
  });

  async function delegate(permissions) {
    const id = unique("delegate");
    await pool.query(
      `INSERT INTO "user" (id, name, email) VALUES ($1, $1, $1 || '@identity.invalid')`,
      [id],
    );
    const role = await saveRole(root, draftRole(unique("delegated"), permissions));
    await assignRole(root, role.id, id);
    return id;
  }

  const names = (page) => page.users.map((user) => user.id);

  it("refuses anyone without the permission, in server functions and the repository", async () => {
    expect((await call(getUsers, null, {})).status).toBe(401);
    expect((await call(getUsers, ordinary, {})).status).toBe(403);
    expect((await call(getUser, ordinary, { userId: ada })).status).toBe(403);
    await expect(listUsers(ordinary, {})).rejects.toMatchObject({ status: 403 });
    await expect(getUserDetail(ordinary, chiara)).rejects.toMatchObject({ status: 403 });
    // Finding people is not enough to browse what their accounts prove.
    const searcher = await delegate(["idp:people:read"]);
    await expect(listUsers(searcher, {})).rejects.toMatchObject({ status: 403 });
  });

  it("reports and filters by what each person's accounts prove", async () => {
    const page = await listUsers(root, { q: tag });
    expect(names(page)).toEqual([ada, bruno, chiara]);
    expect(page.total).toBe(3);
    const [first, second, third] = page.users;
    expect(first).toMatchObject({
      email: `${ada}@polinetwork.example`,
      telegramId: "4242424242",
      polimiEmail: `${ada}@mail.polimi.it`,
      traits: { student: true, telegram: true, polinetwork: true, google: false, passkey: false },
      roles: [],
    });
    expect(second).toMatchObject({
      email: `${bruno}@gmail.example`,
      traits: { student: false, telegram: false, google: true, passkey: true },
      roles: [moderator.key],
    });
    // Untrusted issuers prove nothing, whatever the evidence says.
    expect(third.traits.socio).toBe(false);

    expect(names(await listUsers(root, { q: tag, student: "yes" }))).toEqual([ada]);
    expect(names(await listUsers(root, { q: tag, student: "no" }))).toEqual([bruno, chiara]);
    expect(names(await listUsers(root, { q: tag, telegram: "no", passkey: "yes" }))).toEqual([
      bruno,
    ]);
    expect(names(await listUsers(root, { q: tag, role: moderator.key }))).toEqual([bruno]);
    expect(names(await listUsers(root, { q: tag, role: "master-admin" }))).toEqual([]);
    expect(names(await listUsers(root, { q: tag, sort: "newest", page: 2 }))).toEqual([]);
  });

  it("finds people by Telegram ID, Polimi address, PoliNetwork address, and user ID", async () => {
    expect(names(await listUsers(root, { q: "4242424242" }))).toEqual([ada]);
    expect(names(await listUsers(root, { q: `${ada}@polinetwork` }))).toEqual([ada]);
    expect(
      (await searchUsers(root, `${ada}@polinetwork`)).map((person) => [person.id, person.email]),
    ).toEqual([[ada, `${ada}@polinetwork.example`]]);
    expect(names(await listUsers(root, { q: `${bruno}@mail.polimi` }))).toEqual([bruno]);
    expect(names(await listUsers(root, { q: chiara }))).toEqual([chiara]);
    // Wildcards are searched for literally.
    expect(names(await listUsers(root, { q: `${tag.slice(0, -1)}_` }))).toEqual([]);
  });

  it("keeps people without a known email visible, searchable, and assignable", async () => {
    const search = await call(searchPeople, root, { query: ordinary, roleId: moderator.id });
    expect(search.status).toBe(200);
    expect(search.result).toEqual([
      expect.objectContaining({ id: ordinary, email: null, holdsRole: false }),
    ]);

    const directory = await call(getUsers, root, { q: ordinary });
    expect(directory.status).toBe(200);
    expect(directory.result.users).toEqual([
      expect.objectContaining({ id: ordinary, email: null }),
    ]);

    const detail = await call(getUser, root, { userId: ordinary });
    expect(detail.status).toBe(200);
    expect(detail.result).toMatchObject({ id: ordinary, email: null });
    // Personal data stays out of shared caches.
    expect(detail.headers.get("cache-control")).toBe("no-store");

    try {
      await assignRole(root, moderator.id, ordinary);
      const members = await call(getRoleMembers, root, { roleId: moderator.id });
      expect(members.status).toBe(200);
      expect(members.result.members).toContainEqual(
        expect.objectContaining({ userId: ordinary, email: null }),
      );
    } finally {
      await unassignRole(root, moderator.id, ordinary);
    }
  });

  it("ignores Telegram and Polimi accounts from issuers those providers never use", async () => {
    const [row] = (await listUsers(root, { q: dario })).users;
    expect(row).toMatchObject({
      telegramId: null,
      polimiEmail: null,
      traits: { telegram: false, student: false },
    });
    expect(names(await listUsers(root, { q: dario, telegram: "yes" }))).toEqual([]);
    expect(names(await listUsers(root, { q: dario, telegram: "no" }))).toEqual([dario]);
    expect(names(await listUsers(root, { q: darioMail }))).toEqual([]);
    expect(names(await listUsers(root, { q: "5151515151" }))).toEqual([]);

    const detail = await getUserDetail(root, dario);
    expect(
      detail.accounts.map((entry) => [entry.providerId, entry.identifier, entry.validUntil]),
    ).toEqual([
      ["telegram", null, null],
      ["polimi-email", null, null],
    ]);
  });

  it("falls back to recorded membership only while Graph cannot list the group", async () => {
    mocks.list.mockResolvedValue(null);
    const recorded = await listUsers(root, { q: tag, socio: "yes" });
    expect(recorded.membership).toEqual({ socio: "recorded", direttivo: "unconfigured" });
    expect(names(recorded)).toEqual([ada]);

    // Graph now says Ada has left the group and nobody else is in it.
    mocks.list.mockResolvedValue(new Set([`${chiara}-oid`]));
    const live = await listUsers(root, { q: tag, socio: "yes" });
    expect(live.membership.socio).toBe("live");
    // Chiara's object ID is in the group, but her account is from an untrusted tenant.
    expect(names(live)).toEqual([]);
    expect(names(await listUsers(root, { q: tag, direttivo: "yes" }))).toEqual([]);
  });

  it("withholds roles from someone who may browse users but not read roles", async () => {
    const browser = await delegate(["idp:users:read"]);
    const page = await listUsers(browser, { q: tag });
    expect(page.users.every((user) => user.roles === null)).toBe(true);
    await expect(listUsers(browser, { q: tag, role: moderator.key })).rejects.toMatchObject({
      status: 403,
    });
    const detail = await getUserDetail(browser, bruno);
    expect(detail).toMatchObject({ assignedRoles: null, roles: null, permissions: null });
    const response = await call(getUsers, browser, { q: tag, telegram: "yes" });
    expect(response.status).toBe(200);
    expect(response.result.users.map((user) => user.id)).toEqual([ada]);
  });

  it("shows one person's accounts, live status, and every role they hold", async () => {
    mocks.graph.mockImplementation(async (groupId, objectId) => objectId === `${ada}-oid`);
    const detail = await getUserDetail(root, ada);
    expect(detail.email).toBe(`${ada}@polinetwork.example`);
    expect(detail.states).toEqual(["socio", "student"]);
    expect(detail.telegramId).toBe("4242424242");
    expect(detail.roles).toEqual(["socio", "student"]);
    expect(detail.accounts.map((entry) => [entry.providerId, entry.identifier])).toEqual([
      ["pn-entra", null],
      ["telegram", "4242424242"],
      ["polimi-email", `${ada}@mail.polimi.it`],
    ]);
    expect(detail.accounts[2].validUntil).not.toBeNull();

    const other = await getUserDetail(root, bruno);
    expect(other.passkeys).toBe(1);
    expect(other.states).toEqual([]);
    expect(other.assignedRoles).toEqual([
      expect.objectContaining({
        key: moderator.key,
        assignedBy: { id: root, name: root },
      }),
    ]);
    expect(other.roles).toEqual([moderator.key]);

    await expect(getUserDetail(root, unique("missing"))).rejects.toMatchObject({ status: 404 });
    expect((await call(getUser, root, { userId: unique("missing") })).status).toBe(404);
  });
});
