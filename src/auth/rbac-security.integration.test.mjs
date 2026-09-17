import { createHmac, randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({ graph: vi.fn().mockResolvedValue(false), sendEmail: vi.fn() }));
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
      STUDENT_VERIFICATION_TTL_DAYS: 365,
      IDP_ADMIN_USER_IDS: ["security-root"],
      PN_ENTRA_TENANT_ID: "11111111-1111-4111-8111-111111111111",
      PN_ENTRA_MEMBER_GROUP_ID: "soci",
      PN_ENTRA_OIDC_ADMIN_GROUP_ID: "admins",
    },
  };
});
vi.mock("./membership", () => ({ checkEntraGroupMember: mocks.graph }));
// Only session authentication is substituted; routes, authorization, evidence, SQL and
// transactions are real. The separate identity HTTP suite exercises signed session cookies.
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

vi.mock("./email", () => ({
  studentVerificationEmailConfigured: true,
  sendStudentVerificationEmail: mocks.sendEmail,
}));

import { db } from "../db/index";
import { confirmStudentVerification, requestStudentVerification } from "./student-verification";
import { disconnectAccount } from "./accounts";
import { getIdentity } from "./identity";
import {
  assignRole,
  deletePermission,
  deleteRole,
  loadCatalog,
  savePermission,
  saveRole,
  unassignRole,
} from "./rbac-store";
import { Route as roleSave } from "../routes/api/rbac/role-save";
import { Route as permissionSave } from "../routes/api/rbac/permission-save";
import { Route as members } from "../routes/api/rbac/role-members";
import { Route as clientUpdate } from "../routes/api/oidc/client-update";

const root = "security-root";
const ordinary = "security-ordinary";
const writer = "security-writer";
const draftRole = (key, permissions = [], parents = []) => ({
  key,
  name: key,
  description: "",
  permissions,
  parents,
});
const draftPermission = (key, implies = []) => ({ key, name: key, description: "", implies });
const unique = (name) => `security-${name}-${randomUUID().slice(0, 8)}`;

function post(route, actor, body, origin = "http://localhost:35439") {
  return route.options.server.handlers.POST({
    request: new Request(`http://localhost:35439${route.id ?? "/api/test"}`, {
      method: "POST",
      headers: { "x-test-user": actor, Origin: origin, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  });
}

describe.skipIf(!process.env.RBAC_TEST_DATABASE_URL)("RBAC security with PostgreSQL", () => {
  const pool = new Pool({ connectionString: process.env.RBAC_TEST_DATABASE_URL });
  beforeAll(async () => {
    await pool.query(
      `INSERT INTO "user" (id, name, email) SELECT id, id, id || '@identity.invalid' FROM unnest($1::text[]) AS id`,
      [[root, ordinary, writer]],
    );
  });
  afterAll(async () => {
    await pool.query(`DELETE FROM "user" WHERE id LIKE 'security-%'`);
    await pool.query(`DELETE FROM role WHERE key LIKE 'security-%'`);
    await pool.query(`DELETE FROM permission WHERE key LIKE 'security-%'`);
    await pool.query(`DELETE FROM identity_evidence WHERE subject LIKE 'security-%'`);
    await pool.query(`DELETE FROM oauth_client WHERE client_id LIKE 'security-%'`);
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
    return { id, role };
  }

  it("denies creating a privileged role, self-assigning it, and editing one's own role", async () => {
    const actor = await delegate(["idp:roles:write"]);
    const high = await saveRole(root, draftRole(unique("high"), ["idp:applications:write"]));
    const key = unique("escalation");
    expect(
      (
        await post(roleSave, actor.id, {
          action: "create",
          actorId: root,
          draft: draftRole(key, ["idp:applications:write"]),
        })
      ).status,
    ).toBe(403);
    expect(
      (await post(members, actor.id, { action: "assign", roleId: high.id, userId: actor.id }))
        .status,
    ).toBe(403);
    expect(
      (
        await post(roleSave, actor.id, {
          action: "update",
          roleId: actor.role.id,
          draft: draftRole(actor.role.key, ["idp:roles:write", "idp:applications:write"]),
        })
      ).status,
    ).toBe(403);
    expect((await getIdentity(actor.id)).permissions).not.toContain("idp:applications:write");
    expect((await pool.query("SELECT id FROM role WHERE key = $1", [key])).rows).toEqual([]);
  });

  it("denies transitive role grants, revocation and deletion above one's authority", async () => {
    const actor = await delegate(["idp:roles:write"]);
    const high = await saveRole(root, draftRole(unique("high"), ["idp:applications:write"]));
    expect(
      (
        await post(roleSave, actor.id, {
          action: "create",
          draft: draftRole(unique("inherited"), [], [high.key]),
        })
      ).status,
    ).toBe(403);
    expect((await post(roleSave, actor.id, { action: "delete", roleId: high.id })).status).toBe(
      403,
    );
    expect(
      (await post(members, actor.id, { action: "unassign", roleId: high.id, userId: root })).status,
    ).toBe(403);
  });

  it("denies escalation through managed and custom permission implications", async () => {
    const own = await savePermission(root, draftPermission(unique("own")));
    const actor = await delegate(["idp:permissions:write", own.key]);
    const managed = (await loadCatalog()).permissions.find(
      (entry) => entry.key === "idp:permissions:write",
    );
    for (const target of [managed, own]) {
      expect(
        (
          await post(permissionSave, actor.id, {
            action: "update",
            permissionId: target.id,
            draft: draftPermission(target.key, ["idp:applications:write"]),
          })
        ).status,
      ).toBe(403);
    }
    expect(
      (
        await post(permissionSave, actor.id, {
          action: "update",
          permissionId: own.id,
          draft: draftPermission(unique("renamed-authority")),
        })
      ).status,
    ).toBe(403);
    expect((await getIdentity(actor.id)).permissions).not.toContain("idp:applications:write");
  });

  it("denies bootstrapping new authority with both writer permissions", async () => {
    const actor = await delegate(["idp:roles:write", "idp:permissions:write"]);
    const permission = await savePermission(actor.id, draftPermission(unique("new-capability")));
    expect(
      (
        await post(roleSave, actor.id, {
          action: "create",
          draft: draftRole(unique("new-capability"), [permission.key]),
        })
      ).status,
    ).toBe(403);
    expect((await getIdentity(actor.id)).permissions).not.toContain(permission.key);
    expect(
      (
        await post(permissionSave, actor.id, {
          action: "create",
          draft: draftPermission(unique("laundered"), ["idp:applications:write"]),
        })
      ).status,
    ).toBe(403);
  });

  it("preserves bounded delegation while refusing direct and indirect managed-role edits", async () => {
    const own = await savePermission(root, draftPermission(unique("own")));
    const actor = await delegate(["idp:roles:write", own.key]);
    const low = await saveRole(actor.id, draftRole(unique("low"), [own.key]));
    await assignRole(actor.id, low.id, ordinary);
    expect((await getIdentity(ordinary)).permissions).toContain(own.key);
    await unassignRole(actor.id, low.id, ordinary);
    const managed = (await loadCatalog()).roles.find((entry) => entry.key === "socio");
    expect(
      (
        await post(roleSave, actor.id, {
          action: "update",
          roleId: managed.id,
          draft: draftRole(managed.key, [own.key]),
        })
      ).status,
    ).toBe(403);
    const parent = await saveRole(root, draftRole(unique("managed-parent")));
    await saveRole(root, draftRole(managed.key, managed.permissions, [parent.key]), managed.id);
    try {
      expect(
        (
          await post(roleSave, actor.id, {
            action: "update",
            roleId: parent.id,
            draft: draftRole(parent.key, [own.key]),
          })
        ).status,
      ).toBe(403);
    } finally {
      await saveRole(
        root,
        draftRole(managed.key, managed.permissions, managed.parents),
        managed.id,
      );
    }
  });

  async function challenge(actor) {
    const email = `${unique("student")}@mail.polimi.it`;
    const code = "123456";
    const hash = createHmac("sha256", "test-only-secret-with-at-least-32-characters")
      .update(`${actor}:${email}:${code}`)
      .digest("hex");
    await pool.query(
      `INSERT INTO student_verification_challenge (user_id, email, code_hash, expires_at, last_sent_at) VALUES ($1, $2, $3, now() + interval '10 minutes', now())`,
      [actor, email, hash],
    );
    return { email, code };
  }

  it("denies a correct student code after five concurrent wrong attempts", async () => {
    const actor = await delegate([]);
    const input = await challenge(actor.id);
    const guesses = await Promise.allSettled(
      Array.from({ length: 5 }, () =>
        confirmStudentVerification(actor.id, { ...input, code: "000000" }),
      ),
    );
    expect(guesses.every((entry) => entry.status === "rejected")).toBe(true);
    await expect(confirmStudentVerification(actor.id, input)).rejects.toMatchObject({
      status: 400,
    });
    expect((await getIdentity(actor.id)).roles).not.toContain("student");
  });

  it("denies concurrent code replay and prevents cross-user code consumption", async () => {
    const actor = await delegate([]);
    const input = await challenge(actor.id);
    await expect(confirmStudentVerification(ordinary, input)).rejects.toMatchObject({
      status: 400,
    });
    const results = await Promise.allSettled([
      confirmStudentVerification(actor.id, input),
      confirmStudentVerification(actor.id, input),
    ]);
    expect(results.filter((entry) => entry.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((entry) => entry.status === "rejected")).toHaveLength(1);
    expect((await getIdentity(ordinary)).roles).not.toContain("student");
  });

  it("denies concurrent resend attempts inside the cooldown", async () => {
    const actor = await delegate([]);
    const email = `${unique("resend")}@mail.polimi.it`;
    const results = await Promise.allSettled(
      Array.from({ length: 3 }, () => requestStudentVerification(actor.id, email)),
    );
    expect(results.filter((entry) => entry.status === "fulfilled")).toHaveLength(1);
    expect(
      results
        .filter((entry) => entry.status === "rejected")
        .every((entry) => entry.reason.status === 429),
    ).toBe(true);
  });

  it("denies cross-user unlink and concurrent removal of the last login account", async () => {
    const actor = await delegate([]);
    const first = unique("google");
    const second = unique("entra");
    await pool.query(
      `INSERT INTO account (id, account_id, provider_id, issuer, user_id, updated_at) VALUES ($1, $1, 'google', 'google', $3, now()), ($2, $2, 'pn-entra', 'pn-entra', $3, now())`,
      [first, second, actor.id],
    );
    await expect(disconnectAccount(ordinary, first)).rejects.toMatchObject({ status: 404 });
    const results = await Promise.allSettled([
      disconnectAccount(actor.id, first),
      disconnectAccount(actor.id, second),
    ]);
    expect(results.filter((entry) => entry.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((entry) => entry.status === "rejected")).toHaveLength(1);
    expect(
      (await pool.query(`SELECT id FROM account WHERE user_id = $1`, [actor.id])).rows,
    ).toHaveLength(1);
  });

  it("denies ordinary users at HTTP and direct repository mutation boundaries", async () => {
    const role = await saveRole(root, draftRole(unique("target")));
    const permission = await savePermission(root, draftPermission(unique("permission")));
    for (const action of [
      () => saveRole(ordinary, draftRole(unique("bad"))),
      () => deleteRole(ordinary, role.id),
      () => savePermission(ordinary, draftPermission(unique("bad"))),
      () => deletePermission(ordinary, permission.id),
      () => assignRole(ordinary, role.id, ordinary),
      () => unassignRole(ordinary, role.id, root),
    ])
      await expect(action()).rejects.toMatchObject({ status: 403 });
    expect(
      (await post(roleSave, ordinary, { action: "create", draft: draftRole(unique("http")) }))
        .status,
    ).toBe(403);
    expect(
      (await post(permissionSave, ordinary, { action: "delete", permissionId: permission.id }))
        .status,
    ).toBe(403);
    expect(
      (await post(members, ordinary, { action: "assign", roleId: role.id, userId: ordinary }))
        .status,
    ).toBe(403);
    expect(
      (
        await post(
          roleSave,
          root,
          { action: "delete", roleId: role.id },
          "https://attacker.invalid",
        )
      ).status,
    ).toBe(403);
  });

  it("denies missing/deleted subjects even if the identifier is allowlisted", async () => {
    await expect(getIdentity("not-a-user")).rejects.toThrow("Unknown identity subject");
    await expect(saveRole("not-a-user", draftRole(unique("bad")))).rejects.toThrow();
  });

  it("does not revive removed implications when the catalog is reloaded", async () => {
    const catalog = await loadCatalog();
    const managed = catalog.permissions.find((entry) => entry.key === "idp:applications:write");
    await savePermission(root, draftPermission(managed.key), managed.id);
    const role = await saveRole(root, draftRole(unique("appwriter"), [managed.key]));
    await assignRole(root, role.id, ordinary);
    expect((await getIdentity(ordinary)).permissions).not.toContain("idp:applications:read");
    await loadCatalog();
    expect((await getIdentity(ordinary)).permissions).not.toContain("idp:applications:read");
    await unassignRole(root, role.id, ordinary);
    await savePermission(root, draftPermission(managed.key, ["idp:applications:read"]), managed.id);
  });

  it("denies access immediately after a committed graph or assignment revocation", async () => {
    const permission = await savePermission(root, draftPermission(unique("revocation")));
    const role = await saveRole(root, draftRole(unique("revocation"), [permission.key]));
    await assignRole(root, role.id, ordinary);
    expect((await getIdentity(ordinary)).permissions).toContain(permission.key);
    await saveRole(root, draftRole(role.key), role.id);
    expect((await getIdentity(ordinary)).permissions).not.toContain(permission.key);
    await saveRole(root, draftRole(role.key, [permission.key]), role.id);
    await unassignRole(root, role.id, ordinary);
    expect((await getIdentity(ordinary)).permissions).not.toContain(permission.key);
  });

  it("denies stored 24-hour membership after Graph removal or lookup failure", async () => {
    const issuer = "https://login.microsoftonline.com/11111111-1111-4111-8111-111111111111/v2.0";
    const subject = unique("stale");
    await pool.query(
      `INSERT INTO account (id, account_id, provider_id, issuer, user_id, updated_at) VALUES ($1, $1, 'pn-entra', $2, $3, now())`,
      [subject, issuer, ordinary],
    );
    await pool.query(
      `INSERT INTO identity_evidence (issuer, subject, provider_id, external_id, states, valid_until) VALUES ($1, $2, 'pn-entra', $2, ARRAY['socio'], now() + interval '24 hours')`,
      [issuer, subject],
    );
    mocks.graph.mockResolvedValue(false);
    expect((await getIdentity(ordinary)).roles).not.toContain("socio");
    expect((await getIdentity(ordinary)).roles).not.toContain("master-admin");
    mocks.graph.mockResolvedValue(null);
    await pool.query(
      `UPDATE identity_evidence SET external_id = external_id || '-outage' WHERE subject = $1`,
      [subject],
    );
    expect((await getIdentity(ordinary)).permissions).not.toContain("membership:read");
    await pool.query(`DELETE FROM account WHERE id = $1`, [subject]);
    mocks.graph.mockResolvedValue(false);
  });

  it("denies evidence from another tenant even with a matching provider label", async () => {
    const subject = unique("wrong-tenant");
    await pool.query(
      `INSERT INTO account (id, account_id, provider_id, issuer, user_id, updated_at) VALUES ($1, $1, 'pn-entra', 'https://foreign.invalid', $2, now())`,
      [subject, ordinary],
    );
    await pool.query(
      `INSERT INTO identity_evidence (issuer, subject, provider_id, external_id, states, valid_until) VALUES ('https://foreign.invalid', $1, 'pn-entra', $1, ARRAY['socio'], now() + interval '24 hours')`,
      [subject],
    );
    mocks.graph.mockResolvedValue(true);
    expect((await getIdentity(ordinary)).roles).not.toContain("socio");
    expect((await getIdentity(ordinary)).roles).not.toContain("master-admin");
    await pool.query(`DELETE FROM account WHERE id = $1`, [subject]);
    mocks.graph.mockResolvedValue(false);
  });

  it("rejects managed assignments and root inheritance at the database boundary", async () => {
    await expect(
      pool.query(
        `INSERT INTO user_role (user_id, role_id) VALUES ($1, 'static-role-master-admin')`,
        [ordinary],
      ),
    ).rejects.toThrow("Managed roles cannot be assigned");
    const role = await saveRole(root, draftRole(unique("legacy")));
    await expect(
      pool.query(
        `INSERT INTO role_parent (role_id, parent_role_id) VALUES ($1, 'static-role-master-admin')`,
        [role.id],
      ),
    ).rejects.toThrow("Master Admin cannot be inherited");
  });

  it("keeps durable actor and before/after history and refuses erasure", async () => {
    const role = await saveRole(root, draftRole(unique("audited")));
    await assignRole(root, role.id, ordinary);
    await unassignRole(root, role.id, ordinary);
    await deleteRole(root, role.id);
    const { rows } = await pool.query(
      `SELECT * FROM rbac_audit_event WHERE target_id = $1 ORDER BY "createdAt"`,
      [role.id],
    );
    expect(rows.map((row) => row.operation)).toEqual([
      "role.save",
      "role.assign",
      "role.unassign",
      "role.delete",
    ]);
    expect(rows.every((row) => row.actor_id === root)).toBe(true);
    expect(rows[2].before.assignments[0].userId).toBe(ordinary);
    expect(rows[2].after.assignments).toEqual([]);
    await expect(
      pool.query(`DELETE FROM rbac_audit_event WHERE target_id = $1`, [role.id]),
    ).rejects.toThrow("append-only");
    await expect(
      pool.query(`UPDATE rbac_audit_event SET actor_id = 'erased' WHERE target_id = $1`, [role.id]),
    ).rejects.toThrow("append-only");
    await expect(pool.query(`TRUNCATE rbac_audit_event`)).rejects.toThrow("append-only");
  });

  it("rolls back a mutation if its audit event cannot be stored", async () => {
    await pool.query(
      `CREATE FUNCTION security_fail_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.actor_id = 'security-root' THEN RAISE EXCEPTION 'audit unavailable'; END IF; RETURN NEW; END $$; CREATE TRIGGER security_fail_audit BEFORE INSERT ON rbac_audit_event FOR EACH ROW EXECUTE FUNCTION security_fail_audit()`,
    );
    const key = unique("rollback");
    try {
      await expect(saveRole(root, draftRole(key))).rejects.toThrow();
      expect((await pool.query(`SELECT * FROM role WHERE key = $1`, [key])).rows).toEqual([]);
    } finally {
      await pool.query(
        `DROP TRIGGER security_fail_audit ON rbac_audit_event; DROP FUNCTION security_fail_audit()`,
      );
    }
  });

  it("serializes concurrent opposite graph edges and refuses the cycle", async () => {
    const a = await saveRole(root, draftRole(unique("a")));
    const b = await saveRole(root, draftRole(unique("b")));
    const results = await Promise.allSettled([
      saveRole(root, draftRole(a.key, [], [b.key]), a.id),
      saveRole(root, draftRole(b.key, [], [a.key]), b.id),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
  });

  it("denies an in-flight writer after a queued revoke commits", async () => {
    const authority = await saveRole(root, draftRole(unique("writer"), ["idp:roles:write"]));
    const target = await saveRole(root, draftRole(unique("victim")));
    await assignRole(root, authority.id, writer);
    const connection = await pool.connect();
    await connection.query("BEGIN");
    await connection.query(
      "SELECT pg_advisory_xact_lock(hashtext('polinetwork-auth'), hashtext('rbac-hierarchy'))",
    );
    try {
      await connection.query("DELETE FROM user_role WHERE user_id = $1", [writer]);
      const grant = assignRole(writer, target.id, ordinary);
      // The writer cannot enter its authorization/mutation transaction until commit.
      await connection.query("COMMIT");
      await expect(grant).rejects.toMatchObject({ status: 403 });
      expect(
        (
          await pool.query("SELECT * FROM user_role WHERE user_id = $1 AND role_id = $2", [
            ordinary,
            target.id,
          ])
        ).rows,
      ).toEqual([]);
    } finally {
      await connection.query("ROLLBACK");
      connection.release();
    }
  });

  it("refuses cross-pool client updates even by an application administrator", async () => {
    const client = unique("foreign-client");
    await pool.query(
      `INSERT INTO oauth_client (id, client_id, redirect_uris, reference_id) VALUES ($1, $1, ARRAY['https://example.com/callback'], 'another-pool')`,
      [client],
    );
    expect((await post(clientUpdate, root, { clientId: client, disabled: true })).status).toBe(404);
    expect(
      (await pool.query("SELECT disabled FROM oauth_client WHERE client_id = $1", [client])).rows[0]
        .disabled,
    ).toBe(false);
  });
});
