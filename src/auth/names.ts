import { z } from "zod";

/**
 * People's names. Two kinds, with two rules:
 *
 * - **`entra`:** while a PoliNetwork APS account is linked, the names are the association's
 *   directory's (`givenName`, `surname`), set again at every sign-in. The association creates
 *   those accounts with the person's real name, so applications are told the name is verified,
 *   and the person can't edit it here.
 * - **`self`:** anyone else typed or confirmed their own name. Google's profile name is only a
 *   suggestion: it's confirmed once, at the first sign-in, and can then be edited a few times a
 *   month. Applications are told it's self-declared.
 *
 * `name` stays the join of the two, for Better Auth and for readers that predate them.
 */
export const NAME_SOURCES = ["entra", "self"] as const;
export type NameSource = (typeof NAME_SOURCES)[number];

/**
 * `user.additionalFields` for the name columns. Declared so Better Auth reads and writes them
 * with the user, and `input: false` so no client can set them: the database hooks in `index.ts`
 * and `name-store.ts` do.
 */
export const userNameFields = {
  givenName: { type: "string", required: false, input: false, defaultValue: "" },
  familyName: { type: "string", required: false, input: false, defaultValue: "" },
  nameSource: { type: "string", required: false, input: false, defaultValue: "self" },
  nameConfirmedAt: { type: "date", required: false, input: false },
} as const;

/** The longest first or last name a person may type. */
export const NAME_PART_MAX_LENGTH = 50;

/** How many times someone may edit a self-declared name in `NAME_EDIT_WINDOW_DAYS`. */
export const NAME_EDIT_LIMIT = 3;
export const NAME_EDIT_WINDOW_DAYS = 30;

export type PersonName = { givenName: string; familyName: string };

/** Unicode NFC, trimmed, and any run of whitespace as one space. */
export function normalizeNamePart(value: string) {
  return value.normalize("NFC").replace(/\s+/gu, " ").trim();
}

// Words of letters (any script, with their combining accents) joined by one space, hyphen,
// apostrophe or period: "Anne-Marie", "D'Angelo", "O’Brien", "De Luca", "J. R.".
const WORD = String.raw`\p{L}[\p{L}\p{M}]*`;
const NAME_PART = new RegExp(String.raw`^${WORD}(?:(?:\.?[ \-'’]|\.)${WORD})*\.?$`, "u");

/** Why a first or last name the person typed can't be used, or null when it can. */
export function namePartProblem(value: string, label: "first name" | "last name") {
  const normalized = normalizeNamePart(value);
  if (!normalized) return `Enter your ${label}.`;
  if (normalized.length > NAME_PART_MAX_LENGTH)
    return `Your ${label} can be at most ${NAME_PART_MAX_LENGTH} characters.`;
  if (!NAME_PART.test(normalized))
    return `Use only letters, spaces, apostrophes, hyphens and periods in your ${label}.`;
  return null;
}

function namePart(label: "first name" | "last name") {
  return z
    .string()
    .max(NAME_PART_MAX_LENGTH * 4)
    .transform(normalizeNamePart)
    .superRefine((value, context) => {
      const problem = namePartProblem(value, label);
      if (problem) context.addIssue({ code: "custom", message: problem });
    });
}

/** A self-declared name as the person submits it, normalized. */
export const personNameSchema = z.object({
  givenName: namePart("first name"),
  familyName: namePart("last name"),
});

/** The full name: first and last, as people read it. */
export function joinName({ givenName, familyName }: PersonName) {
  return [givenName, familyName].filter(Boolean).join(" ");
}

// Lowercased words that belong to the family name that follows them.
const SURNAME_PARTICLES = new Set([
  "da",
  "dal",
  "dalla",
  "dalle",
  "dai",
  "das",
  "de",
  "dei",
  "degli",
  "del",
  "della",
  "delle",
  "dello",
  "der",
  "des",
  "di",
  "do",
  "dos",
  "du",
  "la",
  "le",
  "lo",
  "van",
  "von",
]);

/**
 * A best guess at the two parts of a full name, for a name nobody split: the last word is the
 * family name, together with the particles before it ("Maria De Luca", "Anna van der Berg"). A
 * single word is a first name alone. Only a suggestion: self-declared names are confirmed by the
 * person, and Entra's replace it at the next sign-in. The migration that added the columns
 * (`drizzle/0027_user_names.sql`) applies the same rule in SQL.
 */
export function guessNameParts(fullName: string): PersonName {
  const words = normalizeNamePart(fullName).split(" ").filter(Boolean);
  if (words.length <= 1) return { givenName: words[0] ?? "", familyName: "" };
  let start = words.length - 1;
  while (start > 1 && SURNAME_PARTICLES.has(words[start - 1]!.toLowerCase())) start--;
  return {
    givenName: words.slice(0, start).join(" "),
    familyName: words.slice(start).join(" "),
  };
}

/**
 * The names Entra gives, from an ID token's `given_name`/`family_name` claims or Graph's
 * `givenName`/`surname`. Null when it gives neither. They are the directory's, so they aren't
 * held to the rules for typed names, only normalized.
 */
export function directoryName(givenName: unknown, familyName: unknown): PersonName | null {
  const given = typeof givenName === "string" ? normalizeNamePart(givenName) : "";
  const family = typeof familyName === "string" ? normalizeNamePart(familyName) : "";
  return given || family ? { givenName: given, familyName: family } : null;
}

export type NameState = {
  nameSource: NameSource;
  nameConfirmedAt: Date | null;
};

/** Someone whose self-declared name was never confirmed: the guess from Google or the backfill. */
export function needsNameConfirmation(state: NameState) {
  return state.nameSource === "self" && state.nameConfirmedAt === null;
}

/** Whether applications may rely on the name: only the association's directory's. */
export function isNameVerified(nameSource: string) {
  return nameSource === "entra";
}

/**
 * The OIDC `given_name` and `family_name` claims from the stored names. They replace the
 * provider's own, which split `name` at its last space.
 */
export function nameClaims(name: Partial<PersonName>) {
  const claims: Record<string, string> = {};
  if (name.givenName) claims.given_name = name.givenName;
  if (name.familyName) claims.family_name = name.familyName;
  return claims;
}
