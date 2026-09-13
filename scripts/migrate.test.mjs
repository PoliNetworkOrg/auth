import { describe, expect, it, vi } from "vite-plus/test";

import { runWithMigrationLock } from "./migrate.mjs";

describe("database migration lock", () => {
  it("takes the lock before migrating and destroys the locked connection", async () => {
    const events = [];
    const client = {
      query: vi.fn(async () => {
        events.push("lock");
      }),
      release: vi.fn(() => {
        events.push("release");
      }),
    };

    await runWithMigrationLock(client, async () => {
      events.push("migrate");
    });

    expect(events).toEqual(["lock", "migrate", "release"]);
    expect(client.release).toHaveBeenCalledWith(true);
  });

  it("destroys the locked connection when a migration fails", async () => {
    const client = {
      query: vi.fn(async () => {}),
      release: vi.fn(),
    };
    const migrationError = new Error("migration failed");

    await expect(
      runWithMigrationLock(client, async () => {
        throw migrationError;
      }),
    ).rejects.toBe(migrationError);
    expect(client.release).toHaveBeenCalledWith(true);
  });
});
