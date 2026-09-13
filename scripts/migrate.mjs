import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

const migrationLockQuery = `
  select pg_advisory_lock(
    hashtext('polinetwork-auth'),
    hashtext('drizzle-migrations')
  )
`;

export async function runWithMigrationLock(client, applyMigrations) {
  try {
    // Drizzle does not serialize concurrent PostgreSQL migrators. Keep the
    // lock and migration on this dedicated session so replicas cannot race.
    await client.query(migrationLockQuery);
    await applyMigrations(client);
  } finally {
    // Destroying the session releases its advisory lock even when a migration fails.
    client.release(true);
  }
}

export async function migrateDatabase({ connection, migrationsFolder }) {
  const pool = new Pool({
    ...connection,
    max: 1,
  });

  try {
    const client = await pool.connect();
    await runWithMigrationLock(client, async (lockedClient) => {
      await migrate(drizzle({ client: lockedClient }), { migrationsFolder });
    });
  } finally {
    await pool.end();
  }
}
