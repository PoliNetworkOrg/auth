import { fileURLToPath } from "node:url";

import { migrateDatabase } from "./migrate.mjs";

function requiredEnvironmentVariable(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

const databasePort = Number(process.env.DB_PORT ?? "5432");
if (!Number.isInteger(databasePort) || databasePort < 1 || databasePort > 65_535) {
  throw new Error("DB_PORT must be an integer between 1 and 65535");
}

const connection = {
  database: process.env.DB_NAME ?? "polinetwork_auth",
  host: process.env.DB_HOST ?? "localhost",
  password: requiredEnvironmentVariable("DB_PASS"),
  port: databasePort,
  ssl: false,
  user: requiredEnvironmentVariable("DB_USER"),
};
const migrationsFolder = fileURLToPath(new URL("../drizzle", import.meta.url));

console.info("Applying database migrations...");
await migrateDatabase({ connection, migrationsFolder });
console.info("Database migrations are up to date.");

await import("../.output/server/index.mjs");
