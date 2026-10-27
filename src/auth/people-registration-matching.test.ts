import { describe, expect, it } from "vite-plus/test";
import { peopleRegistrationProposals } from "./people-registration-matching";

const person = {
  id: "preliminary",
  firstName: "Mario",
  lastName: "Rossi",
  email: "mario@example.org",
  telegramId: "123",
  linkedUserId: null,
};
const account = {
  sub: "login",
  name: "Another name",
  email: "MARIO@example.org",
  emailVerified: true,
  telegramId: null,
};
describe("preliminary Auth identity proposals", () => {
  it("proposes verified email and stable Telegram identities without linking", () => {
    expect(peopleRegistrationProposals([person], [account])[0]).toMatchObject({
      personId: person.id,
      sub: account.sub,
      reason: "verified-email",
    });
    expect(
      peopleRegistrationProposals(
        [person],
        [{ ...account, emailVerified: false, telegramId: "123" }],
      )[0]?.reason,
    ).toBe("verified-telegram");
  });
  it("does not trust unverified mail and keeps homonyms as name-only reviews", () => {
    expect(peopleRegistrationProposals([person], [{ ...account, emailVerified: false }])).toEqual(
      [],
    );
    expect(
      peopleRegistrationProposals(
        [person],
        [{ ...account, email: "other@example.org", name: "Mario Rossi" }],
      )[0]?.reason,
    ).toBe("name-only");
  });
  it("flags ambiguous or disagreeing verified identifiers", () => {
    expect(
      peopleRegistrationProposals([person], [{ ...account, telegramId: "999" }])[0]?.reason,
    ).toBe("conflicting-identities");
    expect(
      peopleRegistrationProposals([person, { ...person, id: "duplicate" }], [account]).map(
        (proposal) => proposal.reason,
      ),
    ).toEqual(["conflicting-identities", "conflicting-identities"]);
  });
  it("does not propose preliminary subjects or accounts already claimed", () => {
    expect(peopleRegistrationProposals([person], [{ ...account, sub: person.id }])).toEqual([]);
    expect(
      peopleRegistrationProposals([{ ...person, linkedUserId: account.sub }], [account]),
    ).toEqual([]);
  });
});
