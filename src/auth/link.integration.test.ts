import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";

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
      IDP_ADMIN_USER_IDS: ["link-root"],
      PN_ENTRA_TENANT_ID: "11111111-1111-4111-8111-111111111111",
      PN_ENTRA_MEMBER_GROUP_ID: "soci",
    },
  };
});
vi.mock("./membership", () => ({
  checkEntraGroupMember: vi.fn().mockResolvedValue(false),
  listEntraGroupMembers: vi.fn().mockResolvedValue(null),
}));
// Only session authentication is substituted; the server functions, SQL and cookies are real.
vi.mock("./index", () => ({
  auth: {
    api: {
      getSession: async ({ headers }: { headers: Headers }) => {
        const id = headers.get("x-test-user");
        return id ? { user: { id } } : null;
      },
    },
  },
}));
vi.mock("@tanstack/react-start", async (importOriginal) =>
  (await import("./server-fn-harness")).mockReactStart(await importOriginal()),
);
vi.mock(
  "@tanstack/react-start/server",
  async () => (await import("./server-fn-harness")).startServerMock,
);

import { linkAttemptCookie } from "./cookies";
import { getLinkRequest, startLinkAttempt } from "./link.functions";
import { callServerFn } from "./server-fn-harness";

const cookie = linkAttemptCookie(false);
const origin = "http://localhost:35439";

/**
 * `/link` goes back to the application by itself only after this browser started the same link
 * there: these run the real server functions against PostgreSQL to check the attempt cookie.
 */
describe.skipIf(!process.env.RBAC_TEST_DATABASE_URL)("link attempts with PostgreSQL", () => {
  const pool = new Pool({ connectionString: process.env.RBAC_TEST_DATABASE_URL });
  const prefix = `link-${randomUUID().slice(0, 8)}`;
  const person = `${prefix}-person`;
  const client = `${prefix}-dashboard`;
  const returnTo = "https://admin.polinetwork.test/me?tab=setup";
  const request = { method: "telegram" as const, clientId: client, returnTo };

  beforeAll(async () => {
    await pool.query(
      `INSERT INTO "user" (id, name, email) VALUES ($1, $1, $1 || '@identity.invalid')`,
      [person],
    );
    await pool.query(
      `INSERT INTO oauth_client (id, client_id, name, redirect_uris, reference_id)
       VALUES ($1, $1, 'Dashboard', ARRAY['https://admin.polinetwork.test/api/auth/callback'], 'polinetwork')`,
      [client],
    );
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM oauth_client WHERE client_id LIKE $1`, [`${prefix}%`]);
    await pool.query(`DELETE FROM "user" WHERE id LIKE $1`, [`${prefix}%`]);
    await pool.end();
    const { db } = await import("../db/index");
    await db.$client.end();
  });

  function start(data: typeof request, user: string | null = person) {
    return callServerFn(startLinkAttempt, {
      headers: { Origin: origin, ...(user ? { "x-test-user": user } : {}) },
      data,
    });
  }

  function returning(data: typeof request, value?: string) {
    return callServerFn(getLinkRequest, {
      headers: {
        Origin: origin,
        "x-test-user": person,
        ...(value === undefined ? {} : { cookie: `${cookie}=${value}` }),
      },
      data: { ...data, returning: true },
    });
  }

  /** The attempt cookie `start` set, as the browser would send it back. */
  async function startedAttempt() {
    const started = await start(request);
    expect(started.result).toEqual({ recorded: true });
    const set = started.headers.get("set-cookie") ?? "";
    expect(set).toContain("Max-Age=600");
    return set.slice(`${cookie}=`.length).split(";")[0]!;
  }

  it("goes back by itself after the same link started here", async () => {
    const value = await startedAttempt();
    const back = await returning(request, value);
    expect(back.result).toMatchObject({ returnTo, attempted: true, app: { name: "Dashboard" } });
    // The attempt is used up.
    expect(back.headers.get("set-cookie")).toBe(`${cookie}=; Max-Age=0`);
  });

  it("doesn't go back by itself without an attempt", async () => {
    expect((await returning(request)).result).toMatchObject({ returnTo, attempted: false });
  });

  it("doesn't count an attempt for another method or return address", async () => {
    const value = await startedAttempt();
    expect(
      (await returning({ ...request, method: "google" } as never, value)).result,
    ).toMatchObject({ attempted: false });
    expect(
      (await returning({ ...request, returnTo: "https://admin.polinetwork.test/elsewhere" }, value))
        .result,
    ).toMatchObject({ attempted: false });
  });

  it("records nothing without a trusted return address", async () => {
    const started = await start({ ...request, returnTo: "https://evil.example/me" });
    expect(started.result).toEqual({ recorded: false });
    expect(started.headers.get("set-cookie")).toBeNull();
  });

  it("needs a signed-in person to record an attempt", async () => {
    const started = await start(request, null);
    expect(started.status).toBe(401);
    expect(started.headers.get("set-cookie")).toBeNull();
  });
});
