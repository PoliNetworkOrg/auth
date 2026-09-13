import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";
import { z } from "zod";

config({ path: [".env.local", ".env"] });

const databaseEnv = z
  .object({
    DB_HOST: z.string().min(1).default("localhost"),
    DB_PORT: z.coerce.number().int().min(1).max(65_535).default(5432),
    DB_USER: z.string().min(1),
    DB_PASS: z.string().min(1),
    DB_NAME: z.string().min(3).default("polinetwork_auth"),
  })
  .parse(process.env);

export default defineConfig({
  out: "./drizzle",
  schema: "./src/db/schema.ts",
  dialect: "postgresql",
  dbCredentials: {
    database: databaseEnv.DB_NAME,
    host: databaseEnv.DB_HOST,
    port: databaseEnv.DB_PORT,
    user: databaseEnv.DB_USER,
    password: databaseEnv.DB_PASS,
    ssl: false,
  },
});
