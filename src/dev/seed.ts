/**
 * Fills a local development database with the dev personas and a few dozen fake people,
 * so the user directory has something to show. `vp run dev:seed`; safe to run again, since
 * every fake person has a fixed ID and is updated in place.
 */
import { faker } from "@faker-js/faker";
import { assertDevDatabase } from "./database-guard";
import type { DevAccount } from "./personas";

// Checked before anything below connects: the database modules are imported only afterwards.
try {
  assertDevDatabase(process.env, "seed");
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
const { DEV_PERSONAS, saveDevUser } = await import("./personas");

const FAKE_PEOPLE = 60;

// A fixed seed keeps the same people across runs, so links to them keep working.
faker.seed(20_260_930);

for (const persona of DEV_PERSONAS) await saveDevUser(persona);

for (let index = 1; index <= FAKE_PEOPLE; index++) {
  const id = `dev-seed-${String(index).padStart(3, "0")}`;
  const firstName = faker.person.firstName();
  const lastName = faker.person.lastName();
  const dotted = `${firstName}.${lastName}`.toLowerCase().replace(/[^a-z.]/g, "");
  const accounts: DevAccount[] = [];
  const polinetwork = faker.datatype.boolean(0.4);
  if (polinetwork)
    accounts.push({
      providerId: "pn-entra",
      accountId: faker.string.uuid(),
      email: `${dotted}@polinetwork.org`,
      states: faker.datatype.boolean(0.6) ? ["socio"] : [],
    });
  if (!polinetwork || faker.datatype.boolean(0.3))
    accounts.push({ providerId: "google", accountId: faker.string.numeric(21) });
  if (faker.datatype.boolean(0.5))
    accounts.push({
      providerId: "polimi-email",
      accountId: `${dotted}@mail.polimi.it`,
      states: ["student"],
    });
  if (faker.datatype.boolean(0.6))
    accounts.push({
      providerId: "telegram",
      accountId: faker.string.numeric({ length: 9, allowLeadingZeros: false }),
    });

  await saveDevUser({
    id,
    name: `${firstName} ${lastName}`,
    email: `${dotted}.${index}@example.com`,
    createdAt: faker.date.past({ years: 2 }),
    accounts,
  });
}

console.info(`Seeded ${DEV_PERSONAS.length} dev personas and ${FAKE_PEOPLE} fake people.`);
process.exit(0);
