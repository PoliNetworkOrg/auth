import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";

vi.mock("../env", () => {
  const url = new URL(
    process.env.PEOPLE_ROLES_TEST_DATABASE_URL ?? "postgresql://postgres@localhost:55441/postgres",
  );
  return {
    env: {
      DB_HOST: url.hostname,
      DB_PORT: Number(url.port),
      DB_USER: url.username,
      DB_PASS: url.password,
      DB_NAME: url.pathname.slice(1),
      BETTER_AUTH_URL: "http://localhost:35441",
      BETTER_AUTH_SECRET: "test-only-secret-with-at-least-32-characters",
      STUDENT_VERIFICATION_TTL_DAYS: 365,
      IDP_ADMIN_USER_IDS: ["people-root"],
      PN_ENTRA_TENANT_ID: "11111111-1111-4111-8111-111111111111",
      PN_ENTRA_MEMBER_GROUP_ID: "soci",
      PN_ENTRA_OIDC_ADMIN_GROUP_ID: "admins",
    },
  };
});
vi.mock("./membership", () => ({
  checkEntraGroupMember: vi.fn().mockResolvedValue(false),
  checkPnGroupStates: vi.fn().mockResolvedValue([]),
  listEntraGroupMembers: vi.fn().mockResolvedValue(null),
}));

import { db } from "../db/index";
import { changePeopleRoles, readPeopleDirectory } from "./people-roles";
import { assignRole, saveRole, setRolePeopleBinding } from "./rbac-store";

const root = "people-root";
const hr = "people-hr";
const target = "people-target";
const team = `t${randomUUID().slice(0, 8)}`;

describe.skipIf(!process.env.PEOPLE_ROLES_TEST_DATABASE_URL)(
  "People role commands with PostgreSQL",
  () => {
    const pool = new Pool({ connectionString: process.env.PEOPLE_ROLES_TEST_DATABASE_URL });
    const roles: Record<string, string> = {};
    const command = (changes: Parameters<typeof changePeopleRoles>[0]["changes"]) => ({
      id: randomUUID(),
      actor: hr,
      sub: target,
      reason: "Integration test",
      changes,
    });
    const assigned = async () =>
      (
        await pool.query<{ key: string }>(
          `SELECT r.key FROM user_role ur JOIN role r ON r.id = ur.role_id WHERE ur.user_id = $1 ORDER BY r.key`,
          [target],
        )
      ).rows.map((row) => row.key);

    beforeAll(async () => {
      await pool.query(
        `INSERT INTO "user" (id, name, email) SELECT id, id, id || '@identity.invalid' FROM unnest($1::text[]) AS id`,
        [[root, hr, target]],
      );
      await pool.query(
        `INSERT INTO permission (id, key, name) VALUES ($1, 'people:write', 'people:write'), ($2, 'admin:access', 'admin:access')
         ON CONFLICT DO NOTHING`,
        [randomUUID(), randomUUID()],
      );
      const role = async (key: string, permissions: string[], parents: string[] = []) => {
        const saved = await saveRole(root, {
          key,
          name: key,
          description: "",
          permissions,
          parents,
        });
        roles[key] = saved.id;
        return saved;
      };
      await role(`${team}-hr`, ["people:write", "admin:access"]);
      await role(`${team}-member`, []);
      await role(`${team}-lead`, [], [`${team}-member`]);
      await role(`${team}-admin`, []);
      await setRolePeopleBinding(root, roles[`${team}-admin`]!, "admin");
      await setRolePeopleBinding(root, roles[`${team}-member`]!, `team:${team}:member`);
      await setRolePeopleBinding(root, roles[`${team}-lead`]!, `team:${team}:lead`);
      await assignRole(root, roles[`${team}-hr`]!, hr);
    });

    afterAll(async () => {
      await pool.query(`DELETE FROM "user" WHERE id = ANY($1)`, [[root, hr, target]]);
      await pool.query(`DELETE FROM role WHERE key LIKE $1`, [`${team}-%`]);
      await pool.end();
      await db.$client.end();
    });

    it("applies a command once, replays it after a lost response and refuses a reused ID", async () => {
      const add = command([{ kind: "team", team, role: "member" }]);
      expect(await changePeopleRoles(add)).toMatchObject({ assigned: [`${team}-member`] });
      // A retry returns the current state and writes nothing more.
      const events = await pool.query(`SELECT count(*)::int AS n FROM rbac_audit_event`);
      expect(await changePeopleRoles(structuredClone(add))).toMatchObject({
        assigned: [`${team}-member`],
      });
      expect((await pool.query(`SELECT count(*)::int AS n FROM rbac_audit_event`)).rows[0].n).toBe(
        events.rows[0].n,
      );
      await expect(
        changePeopleRoles({ ...add, changes: [{ kind: "team", team, role: null }] }),
      ).rejects.toMatchObject({ status: 409 });
      expect(await assigned()).toEqual([`${team}-member`]);
    });

    it("writes nothing when one of the assignments is refused", async () => {
      // people:write but not people:appoint: the Lead is refused, so the admin role is too.
      await expect(
        changePeopleRoles(
          command([
            { kind: "admin", active: true },
            { kind: "team", team, role: "lead" },
          ]),
        ),
      ).rejects.toMatchObject({ status: 403 });
      expect(await assigned()).toEqual([`${team}-member`]);
    });

    it("refuses to report a revocation that an unbound parent role keeps in place", async () => {
      const wrapper = await saveRole(root, {
        key: `${team}-wrapper`,
        name: "wrapper",
        description: "",
        permissions: [],
        parents: [`${team}-member`],
      });
      await assignRole(root, wrapper.id, target);
      await expect(
        changePeopleRoles(command([{ kind: "team", team, role: null }])),
      ).rejects.toMatchObject({ status: 409, message: expect.stringContaining("inherited") });
      expect(await assigned()).toEqual([`${team}-member`, `${team}-wrapper`]);
      const directory = await readPeopleDirectory();
      expect(directory.users.find((entry) => entry.sub === target)).toMatchObject({
        roles: [`${team}-member`],
        assigned: [`${team}-member`],
      });
    });
  },
);
