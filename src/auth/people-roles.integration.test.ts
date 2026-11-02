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
const binder = "people-binder";
const users = [root, hr, target, binder];
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
        [users],
      );
      await pool.query(
        `INSERT INTO permission (id, key, name) VALUES ($1, 'people:write', 'people:write'), ($2, 'admin:access', 'admin:access'),
           ($3, 'people:appoint', 'people:appoint'), ($4, $5, $5)
         ON CONFLICT DO NOTHING`,
        [randomUUID(), randomUUID(), randomUUID(), randomUUID(), `${team}:perk`],
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
      await role(`${team}-capo`, [], [`${team}-admin`]);
      await role(`${team}-binder`, ["idp:people:bind", "admin:access"]);
      await role(`${team}-perk`, [`${team}:perk`]);
      await role(`${team}-plain`, ["admin:access"]);
      await setRolePeopleBinding(root, roles[`${team}-admin`]!, "admin");
      await setRolePeopleBinding(root, roles[`${team}-capo`]!, "capo");
      await setRolePeopleBinding(root, roles[`${team}-member`]!, `team:${team}:member`);
      await setRolePeopleBinding(root, roles[`${team}-lead`]!, `team:${team}:lead`);
      await assignRole(root, roles[`${team}-hr`]!, hr);
      await assignRole(root, roles[`${team}-binder`]!, binder);
    });

    afterAll(async () => {
      await pool.query(`DELETE FROM "user" WHERE id = ANY($1)`, [users]);
      await pool.query(`DELETE FROM role WHERE key LIKE $1`, [`${team}-%`]);
      await pool.query(`DELETE FROM permission WHERE key = $1`, [`${team}:perk`]);
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

    it("applies an accepted invite with the assigner as actor, never the invitee", async () => {
      const invite = command([{ kind: "admin", active: true }]);
      await expect(changePeopleRoles({ ...invite, actor: target })).rejects.toMatchObject({
        status: 403,
        message: expect.stringContaining("themselves"),
      });
      expect(await changePeopleRoles(invite)).toMatchObject({
        held: expect.arrayContaining([`${team}-admin`]),
      });
      const [audit] = (
        await pool.query<{ actor_id: string; after: { via: string; userId: string } }>(
          `SELECT actor_id, after FROM rbac_audit_event WHERE operation = 'role.assign' AND after->>'commandId' = $1`,
          [invite.id],
        )
      ).rows;
      expect(audit).toMatchObject({ actor_id: hr, after: { via: "people", userId: target } });
    });

    it("needs people:appoint to appoint a Capo Admin, who then holds admin through Capo", async () => {
      const appoint = command([{ kind: "capo", active: true }]);
      await expect(changePeopleRoles(appoint)).rejects.toMatchObject({
        status: 403,
        message: expect.stringContaining("people:appoint"),
      });
      expect(await changePeopleRoles({ ...appoint, actor: root })).toMatchObject({
        held: expect.arrayContaining([`${team}-admin`, `${team}-capo`]),
      });
      // Ending the admin role alone would leave it in place through Capo.
      await expect(
        changePeopleRoles({ ...command([{ kind: "admin", active: false }]), actor: root }),
      ).rejects.toMatchObject({ status: 409 });
    });

    it("lists only holders of bound roles, with when they got each one", async () => {
      const directory = await readPeopleDirectory();
      expect(directory.roles.map((entry) => entry.binding)).toEqual(
        expect.arrayContaining(["admin", "capo", `team:${team}:member`, `team:${team}:lead`]),
      );
      expect(directory.roles.find((entry) => entry.key === `${team}-capo`)).toMatchObject({
        permissions: [],
        bindings: ["capo", "admin"],
      });
      const today = new Date().toISOString().slice(0, 10);
      const person = directory.users.find((entry) => entry.sub === target)!;
      expect(person).not.toHaveProperty("azureId");
      expect(person.since).toMatchObject({
        [`${team}-admin`]: today,
        [`${team}-capo`]: today,
        [`${team}-member`]: today,
      });
      expect(directory.users.some((entry) => entry.sub === binder)).toBe(false);
    });

    it("lets idp:people:bind holders bind roles, only within the permissions they hold", async () => {
      await expect(
        setRolePeopleBinding(hr, roles[`${team}-plain`]!, `team:${team}x:member`),
      ).rejects.toMatchObject({ status: 403 });
      await expect(
        setRolePeopleBinding(binder, roles[`${team}-perk`]!, `team:${team}x:member`),
      ).rejects.toMatchObject({ status: 403 });
      expect(
        await setRolePeopleBinding(binder, roles[`${team}-plain`]!, `team:${team}x:member`),
      ).toMatchObject({ peopleBinding: `team:${team}x:member` });
      await expect(
        setRolePeopleBinding(binder, roles[`${team}-plain`]!, "capo:x"),
      ).rejects.toMatchObject({ status: 400 });
      expect(await setRolePeopleBinding(binder, roles[`${team}-plain`]!, null)).toMatchObject({
        peopleBinding: null,
      });
    });
  },
);
