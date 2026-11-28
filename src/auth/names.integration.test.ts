import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";

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
      IDP_ADMIN_USER_IDS: [],
      PN_ENTRA_TENANT_ID: "11111111-1111-4111-8111-111111111111",
      PN_ENTRA_MEMBER_GROUP_ID: "soci",
    },
  };
});
const graph = vi.hoisted(() => ({ readEntraUserNames: vi.fn() }));
vi.mock("./membership", () => ({
  checkEntraGroupMember: vi.fn().mockResolvedValue(false),
  listEntraGroupMembers: vi.fn().mockResolvedValue(null),
  readEntraUserNames: graph.readEntraUserNames,
}));

import { ActionError } from "../lib/action-error";
import { disconnectAccount } from "./accounts";
import { getOidcClaims, getUserClaims } from "./identity";
import { readNameDetails, saveSelfDeclaredName, syncNames } from "./name-store";

const ENTRA_ISSUER = "https://login.microsoftonline.com/11111111-1111-4111-8111-111111111111/v2.0";

/** An unsigned JWT: only its payload is read, for Google's name suggestion. */
function idToken(claims: Record<string, unknown>) {
  const part = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${part({ alg: "none" })}.${part(claims)}.`;
}

/**
 * Names against PostgreSQL: the directory's name replacing a self-declared one, edits refused
 * while it applies, the edit limit and its audit trail, and the claims apps receive.
 */
describe.skipIf(!process.env.RBAC_TEST_DATABASE_URL)("names with PostgreSQL", () => {
  const pool = new Pool({ connectionString: process.env.RBAC_TEST_DATABASE_URL });
  const prefix = `names-${randomUUID().slice(0, 8)}`;
  let counter = 0;

  async function person(
    fullName: string,
    names: { given: string; family: string; source?: "entra" | "self"; confirmed?: boolean },
  ) {
    const id = `${prefix}-${++counter}`;
    await pool.query(
      `INSERT INTO "user" (id, name, email, given_name, family_name, name_source, name_confirmed_at)
       VALUES ($1, $2, $1 || '@identity.invalid', $3, $4, $5, CASE WHEN $6 THEN now() END)`,
      [id, fullName, names.given, names.family, names.source ?? "self", names.confirmed ?? true],
    );
    return id;
  }

  async function linkGoogle(userId: string, claims: Record<string, unknown> = {}) {
    await pool.query(
      `INSERT INTO account (id, account_id, provider_id, issuer, user_id, id_token, created_at, updated_at)
       VALUES ($1 || ':google', $1 || '-google', 'google', 'https://accounts.google.com', $1, $2, now(), now())`,
      [userId, idToken(claims)],
    );
  }

  /** `checkedMinutesAgo`: when the directory last answered with `names` (default: just now). */
  async function linkEntra(
    userId: string,
    names: { given: string; family: string } | null,
    checkedMinutesAgo = 0,
  ) {
    await pool.query(
      `INSERT INTO account (id, account_id, provider_id, issuer, user_id, created_at, updated_at)
       VALUES ($1 || ':entra', $1 || '-entra', 'pn-entra', $2, $1, now(), now())`,
      [userId, ENTRA_ISSUER],
    );
    await pool.query(
      `INSERT INTO identity_evidence (issuer, subject, provider_id, external_id, states, valid_until, given_name, family_name, names_checked_at)
       VALUES ($2, $1 || '-entra', 'pn-entra', $1 || '-oid', '{}', now() + interval '1 day', $3, $4,
         CASE WHEN $3::text IS NOT NULL THEN now() - make_interval(mins => $5) END)`,
      [userId, ENTRA_ISSUER, names?.given ?? null, names?.family ?? null, checkedMinutesAgo],
    );
    return `${userId}:entra`;
  }

  async function stored(userId: string) {
    const { rows } = await pool.query(
      `SELECT name, given_name, family_name, name_source, name_confirmed_at FROM "user" WHERE id = $1`,
      [userId],
    );
    return rows[0];
  }

  async function auditTrail(userId: string) {
    const { rows } = await pool.query(
      `SELECT operation, actor_id, before, after FROM rbac_audit_event
       WHERE target_id = $1 AND operation LIKE 'user.name.%' ORDER BY "createdAt", id`,
      [userId],
    );
    return rows;
  }

  async function refusal(promise: Promise<unknown>) {
    const error = await promise.then(
      () => null,
      (cause: unknown) => cause,
    );
    expect(error).toBeInstanceOf(ActionError);
    return error as ActionError;
  }

  beforeAll(async () => {
    await pool.query("SELECT 1");
  });

  // Each person has their own Entra object ID, so Graph failures remembered for one never
  // affect another.
  beforeEach(() => {
    graph.readEntraUserNames.mockReset();
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM identity_evidence WHERE subject LIKE $1`, [`${prefix}%`]);
    await pool.query(`DELETE FROM "user" WHERE id LIKE $1`, [`${prefix}%`]);
    await pool.end();
  });

  it("replaces a self-declared name with the directory's when PoliNetwork APS is linked", async () => {
    const id = await person("Mario Rossi", { given: "Mario", family: "Rossi" });
    await linkEntra(id, { given: "Maria", family: "De Luca" });

    await syncNames(id);

    expect(await stored(id)).toMatchObject({
      name: "Maria De Luca",
      given_name: "Maria",
      family_name: "De Luca",
      name_source: "entra",
    });
    expect(await auditTrail(id)).toEqual([
      {
        operation: "user.name.entra",
        actor_id: "system",
        before: { givenName: "Mario", familyName: "Rossi", source: "self" },
        after: { givenName: "Maria", familyName: "De Luca", source: "entra" },
      },
    ]);
    // Nothing changed at the next sign-in: nothing written, nothing audited.
    await syncNames(id);
    expect(await auditTrail(id)).toHaveLength(1);
    expect(graph.readEntraUserNames).not.toHaveBeenCalled();
  });

  it("sends the stored parts to applications: 'Maria De Luca' is Maria + De Luca", async () => {
    const id = await person("Maria De Luca", { given: "Maria", family: "De Luca" });
    await linkEntra(id, { given: "Maria", family: "De Luca" });
    await syncNames(id);

    // The ID token and UserInfo take the names and the flag from one read.
    expect(await getUserClaims(id, ["openid", "profile"])).toEqual({
      given_name: "Maria",
      family_name: "De Luca",
    });
    expect(await getUserClaims(id, ["openid"])).toEqual({});
    // A UserInfo request naming one claim without `profile` gets that one, from the stored parts.
    expect(await getUserClaims(id, ["openid"], ["family_name"])).toEqual({
      family_name: "De Luca",
    });
    expect(await getUserClaims(id, ["openid", "profile", "polinetwork:identity"])).toMatchObject({
      given_name: "Maria",
      family_name: "De Luca",
      polinetwork_name_verified: true,
    });

    const self = await person("Anna Bianchi", { given: "Anna", family: "Bianchi" });
    expect(await getOidcClaims(self, ["openid", "polinetwork:identity"])).toMatchObject({
      polinetwork_name_verified: false,
    });
  });

  it("reads the directory through Graph for people backfilled before their next sign-in", async () => {
    const id = await person("Luca Verdi", { given: "Luca", family: "Verdi", source: "entra" });
    await linkEntra(id, null);
    graph.readEntraUserNames.mockResolvedValue({ givenName: "Luca Maria", familyName: "Verdi" });

    await syncNames(id);

    expect(graph.readEntraUserNames).toHaveBeenCalledWith(`${id}-oid`);
    expect(await stored(id)).toMatchObject({ given_name: "Luca Maria", name_source: "entra" });
    const { rows } = await pool.query(
      `SELECT given_name, family_name FROM identity_evidence WHERE subject = $1`,
      [`${id}-entra`],
    );
    expect(rows[0]).toEqual({ given_name: "Luca Maria", family_name: "Verdi" });
  });

  it("keeps the stored name, unverified, when the directory can't be read", async () => {
    // A confirmed self-declared name, then PoliNetwork APS is linked while Graph is down.
    const id = await person("Paolo Neri", { given: "Paolo", family: "Neri" });
    await linkEntra(id, null);
    graph.readEntraUserNames.mockResolvedValue(null);

    await syncNames(id);
    await syncNames(id);

    expect(await stored(id)).toMatchObject({
      given_name: "Paolo",
      family_name: "Neri",
      name_source: "entra",
      name_confirmed_at: null,
    });
    // Not the directory's name, so applications aren't told it's verified.
    expect(await getOidcClaims(id, ["polinetwork:identity"])).toMatchObject({
      polinetwork_name_verified: false,
    });
    // A failed read isn't retried on every sign-in.
    expect(graph.readEntraUserNames).toHaveBeenCalledTimes(1);
  });

  it("asks a backfilled guess to be confirmed if PoliNetwork APS is unlinked before a read", async () => {
    const id = await person("PoliNetwork user", {
      given: "PoliNetwork",
      family: "user",
      source: "entra",
      confirmed: false,
    });
    await linkGoogle(id);
    const entra = await linkEntra(id, null);
    graph.readEntraUserNames.mockResolvedValue(null);

    await disconnectAccount(id, entra);

    expect(await stored(id)).toMatchObject({ name_source: "self", name_confirmed_at: null });
    expect(await readNameDetails(id)).toMatchObject({ needsConfirmation: true, managed: false });
  });

  it("tells the backend when a name becomes verified, and not for other saves", async () => {
    const outbox = async () =>
      (
        await pool.query(
          `SELECT count(*)::int AS n FROM access_outbox WHERE projection = 'backend'`,
        )
      ).rows[0].n as number;
    const id = await person("Carla Moretti", { given: "Carla", family: "Moretti" });
    await linkEntra(id, { given: "Carla", family: "Moretti" });
    await pool.query(`DELETE FROM access_outbox`);

    await syncNames(id);
    expect(await outbox()).toBe(1);

    await pool.query(`DELETE FROM access_outbox`);
    await pool.query(`UPDATE "user" SET name_source = 'entra' WHERE id = $1`, [id]);
    expect(await outbox()).toBe(0);
  });

  it("reads the directory again on other sign-ins once the saved names are an hour old", async () => {
    const fresh = await person("Elena Costa", { given: "Elena", family: "Costa" });
    await linkEntra(fresh, { given: "Elena", family: "Costa" }, 5);
    await syncNames(fresh);
    expect(graph.readEntraUserNames).not.toHaveBeenCalled();

    const stale = await person("Marco Riva", { given: "Marco", family: "Riva" });
    await linkEntra(stale, { given: "Marco", family: "Riva" }, 90);
    graph.readEntraUserNames.mockResolvedValue({ givenName: "Marco", familyName: "Riva Bassi" });
    await syncNames(stale);

    expect(graph.readEntraUserNames).toHaveBeenCalledWith(`${stale}-oid`);
    expect(await stored(stale)).toMatchObject({ family_name: "Riva Bassi", name_source: "entra" });
    const { rows } = await pool.query(
      `SELECT family_name, names_checked_at > now() - interval '1 minute' AS refreshed
       FROM identity_evidence WHERE subject = $1`,
      [`${stale}-entra`],
    );
    expect(rows[0]).toEqual({ family_name: "Riva Bassi", refreshed: true });
  });

  it("keeps the saved directory names when a refresh fails", async () => {
    const id = await person("Sara Fontana", { given: "Sara", family: "Fontana" });
    await linkEntra(id, { given: "Sara", family: "Fontana Gialli" }, 90);
    graph.readEntraUserNames.mockResolvedValue(null);

    await syncNames(id);

    expect(await stored(id)).toMatchObject({ family_name: "Fontana Gialli", name_source: "entra" });
    expect((await stored(id)).name_confirmed_at).not.toBeNull();
  });

  it("refuses edits while PoliNetwork APS is linked, and allows them once it's unlinked", async () => {
    const id = await person("Giulia Russo", { given: "Giulia", family: "Russo" });
    await linkGoogle(id);
    const entra = await linkEntra(id, { given: "Giulia", family: "Russo" });
    await syncNames(id);

    const refused = await refusal(
      saveSelfDeclaredName(id, { givenName: "Someone", familyName: "Else" }),
    );
    expect(refused.status).toBe(409);
    expect(await readNameDetails(id)).toMatchObject({ managed: true, needsConfirmation: false });

    await disconnectAccount(id, entra);

    expect(await stored(id)).toMatchObject({ given_name: "Giulia", name_source: "self" });
    expect((await stored(id)).name_confirmed_at).not.toBeNull();
    expect((await auditTrail(id)).map((event) => event.operation)).toEqual([
      "user.name.entra",
      "user.name.release",
    ]);
    expect(
      await saveSelfDeclaredName(id, { givenName: "Giulia", familyName: "Russo Bianchi" }),
    ).toEqual({ saved: true });
  });

  it("confirms a self-declared name once, then limits edits to 3 in 30 days", async () => {
    const id = await person("Fra", { given: "Fra", family: "", confirmed: false });
    expect(await readNameDetails(id)).toMatchObject({ needsConfirmation: true, editsLeft: 3 });

    await saveSelfDeclaredName(id, { givenName: "Francesca", familyName: "Gallo" });
    expect(await stored(id)).toMatchObject({ name: "Francesca Gallo", name_source: "self" });
    expect((await stored(id)).name_confirmed_at).not.toBeNull();

    // The confirmation and an unchanged save don't count.
    expect(await saveSelfDeclaredName(id, { givenName: "Francesca", familyName: "Gallo" })).toEqual(
      { saved: false },
    );
    for (const familyName of ["Galli", "Gallo", "Galletti"])
      expect(await saveSelfDeclaredName(id, { givenName: "Francesca", familyName })).toEqual({
        saved: true,
      });
    expect(await readNameDetails(id)).toMatchObject({ editsLeft: 0 });
    expect((await readNameDetails(id)).nextEditAt).not.toBeNull();

    const limited = await refusal(
      saveSelfDeclaredName(id, { givenName: "Francesca", familyName: "Rossi" }),
    );
    expect(limited.status).toBe(429);
    expect(limited.message).toMatch(/3 times in 30 days/);
    expect(await stored(id)).toMatchObject({ family_name: "Galletti" });

    const trail = await auditTrail(id);
    expect(trail.map((event) => event.operation)).toEqual([
      "user.name.confirm",
      "user.name.edit",
      "user.name.edit",
      "user.name.edit",
    ]);
    expect(trail[0]).toMatchObject({
      actor_id: id,
      before: { givenName: "Fra", familyName: "", source: "self" },
      after: { givenName: "Francesca", familyName: "Gallo", source: "self" },
    });

    // Edits older than 30 days no longer count.
    await pool.query(
      `ALTER TABLE rbac_audit_event DISABLE TRIGGER rbac_audit_append_only;
       UPDATE rbac_audit_event SET "createdAt" = now() - interval '31 days'
       WHERE target_id = $1 AND operation = 'user.name.edit'
         AND "createdAt" = (SELECT min("createdAt") FROM rbac_audit_event WHERE target_id = $1 AND operation = 'user.name.edit');
       ALTER TABLE rbac_audit_event ENABLE TRIGGER rbac_audit_append_only;`.replaceAll(
        "$1",
        `'${id}'`,
      ),
    );
    expect(await saveSelfDeclaredName(id, { givenName: "Francesca", familyName: "Rossi" })).toEqual(
      { saved: true },
    );
  });

  it("suggests Google's first and last names until the person confirms theirs", async () => {
    const id = await person("frankie", { given: "frankie", family: "", confirmed: false });
    await linkGoogle(id, { given_name: "Francesco", family_name: "De Santis" });

    await syncNames(id);
    expect(await stored(id)).toMatchObject({
      name: "Francesco De Santis",
      given_name: "Francesco",
      family_name: "De Santis",
      name_source: "self",
      name_confirmed_at: null,
    });
    expect(await auditTrail(id)).toEqual([]);

    // Once confirmed, Google's profile no longer changes it.
    await saveSelfDeclaredName(id, { givenName: "Frankie", familyName: "De Santis" });
    await syncNames(id);
    expect(await stored(id)).toMatchObject({ given_name: "Frankie" });
  });
});
