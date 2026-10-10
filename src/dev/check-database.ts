/**
 * `vp run dev:setup` and `vp run dev:seed` run this before migrating or seeding. It reads the
 * environment the way `drizzle.config.ts` does (`.env.local`, then `.env` for anything missing,
 * never overriding the shell), so it checks the database the migrations would actually use.
 */
import { config } from "dotenv";
import { assertDevDatabase } from "./database-guard";

config({ path: [".env.local", ".env"], quiet: true });

try {
  assertDevDatabase(process.env, "migrate or seed");
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
