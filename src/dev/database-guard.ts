/**
 * Refuses to let the dev tooling (`vp run dev:setup`, `vp run dev:seed`) touch anything but a
 * local development database. The seed writes test people, a Master Admin persona and fake
 * evidence, and the migrations run before it, so both must stop before connecting anywhere else.
 */

/** Hosts a development database may live on: this machine, or the `db` service of
 * `compose.yaml` when the tooling runs inside the Compose network. */
export const LOCAL_DATABASE_HOSTS = ["localhost", "127.0.0.1", "::1", "[::1]", "db"];

const LOOPBACK_ORIGINS = ["localhost", "127.0.0.1", "[::1]"];

type Environment = Record<string, string | undefined>;

/** Every reason the environment is not a local development one. Empty when it is. */
export function devDatabaseProblems(environment: Environment): string[] {
  const problems: string[] = [];
  if (environment.NODE_ENV === "production")
    problems.push("NODE_ENV is production. The dev database tooling never runs in production.");
  // Same default as `src/env.ts` and `drizzle.config.ts`, so this checks what they connect to.
  const host = (environment.DB_HOST?.trim() || "localhost").toLowerCase();
  if (!LOCAL_DATABASE_HOSTS.includes(host))
    problems.push(
      `DB_HOST is ${JSON.stringify(environment.DB_HOST)}, not a local database (${LOCAL_DATABASE_HOSTS.join(", ")}).`,
    );
  // Unset, the app falls back to the production origin, so that is not local either.
  let origin: string | undefined;
  try {
    origin = new URL(environment.BETTER_AUTH_URL ?? "").hostname;
  } catch {
    origin = undefined;
  }
  if (!origin || !LOOPBACK_ORIGINS.includes(origin))
    problems.push("BETTER_AUTH_URL is not a local development origin.");
  return problems;
}

/** Throws, naming every problem, unless the environment is a local development one. */
export function assertDevDatabase(environment: Environment, action: string) {
  const problems = devDatabaseProblems(environment);
  if (problems.length) throw new Error(`Refusing to ${action}:\n- ${problems.join("\n- ")}`);
}
