import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vite-plus/test";
import { assertDevDatabase, devDatabaseProblems } from "./database-guard";

const local = {
  DB_HOST: "localhost",
  BETTER_AUTH_URL: "http://localhost:3000",
  NODE_ENV: "development",
};

describe("dev database guard", () => {
  it.each([
    local,
    { ...local, DB_HOST: "127.0.0.1" },
    { ...local, DB_HOST: "::1" },
    { ...local, DB_HOST: "db" },
    { ...local, DB_HOST: undefined },
    { ...local, NODE_ENV: undefined },
  ])("accepts a local development database: %j", (environment) => {
    expect(devDatabaseProblems(environment)).toEqual([]);
  });

  it.each([
    "db.polinetwork.org",
    "10.0.0.5",
    "localhost.attacker.example",
    "127.0.0.1.nip.io",
    "/var/run/postgresql",
  ])("refuses the remote DB_HOST %j", (DB_HOST) => {
    expect(devDatabaseProblems({ ...local, DB_HOST })).toEqual([
      expect.stringContaining("DB_HOST"),
    ]);
  });

  it("refuses production even on a local database and with DEV_LOGIN unset", () => {
    expect(devDatabaseProblems({ ...local, NODE_ENV: "production" })).toEqual([
      expect.stringContaining("NODE_ENV is production"),
    ]);
  });

  it.each([undefined, "https://auth.polinetwork.org", "http://localhost.attacker.example"])(
    "refuses BETTER_AUTH_URL %j",
    (BETTER_AUTH_URL) => {
      expect(devDatabaseProblems({ ...local, BETTER_AUTH_URL })).toEqual([
        expect.stringContaining("BETTER_AUTH_URL"),
      ]);
    },
  );

  it("names every problem when it refuses", () => {
    expect(() =>
      assertDevDatabase({ DB_HOST: "db.example.com", NODE_ENV: "production" }, "seed"),
    ).toThrow(/Refusing to seed:\n- NODE_ENV.*\n- DB_HOST.*\n- BETTER_AUTH_URL/);
  });
});

describe("dev database scripts", () => {
  // An empty directory, so a developer's own `.env.local` cannot change the outcome.
  const cwd = mkdtempSync(join(tmpdir(), "dev-database-guard-"));
  afterAll(() => rmSync(cwd, { recursive: true, force: true }));
  const tsx = fileURLToPath(new URL("../../node_modules/.bin/tsx", import.meta.url));

  function run(script: string, environment: Record<string, string>) {
    const result = spawnSync(tsx, [fileURLToPath(new URL(script, import.meta.url))], {
      cwd,
      encoding: "utf8",
      timeout: 60_000,
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        DB_USER: "postgres",
        DB_PASS: "postgres",
        // Nothing listens here, so reaching the database would fail differently.
        DB_PORT: "1",
        IDP_ADMIN_USER_IDS: "dev-admin",
        BETTER_AUTH_SECRET: "a-custom-secret-that-is-at-least-32-characters",
        ...local,
        ...environment,
      },
    });
    return { status: result.status, output: `${result.stdout}${result.stderr}` };
  }

  it("stops the seed in production before it connects, with DEV_LOGIN unset", () => {
    const { status, output } = run("./seed.ts", { NODE_ENV: "production" });
    expect(output).toContain("Refusing to seed");
    expect(output).toContain("NODE_ENV is production");
    expect(status).toBe(1);
  });

  it("stops the seed against a remote database", () => {
    const { status, output } = run("./seed.ts", { DB_HOST: "db.polinetwork.org" });
    expect(output).toContain("Refusing to seed");
    expect(output).toContain("DB_HOST");
    expect(status).toBe(1);
  });

  it("stops dev:setup and dev:seed before migrating a remote database", () => {
    const { status, output } = run("./check-database.ts", { DB_HOST: "db.polinetwork.org" });
    expect(output).toContain("Refusing to migrate or seed");
    expect(status).toBe(1);
  });

  it("lets a local development database through", () => {
    expect(run("./check-database.ts", {})).toEqual({ status: 0, output: "" });
  });
});
