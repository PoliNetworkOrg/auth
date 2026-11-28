import { describe, expect, it } from "vite-plus/test";
import {
  directoryName,
  guessNameParts,
  isNameVerified,
  joinName,
  nameClaims,
  namePartProblem,
  needsNameConfirmation,
  personNameSchema,
} from "./names";

describe("best guess at a full name's parts", () => {
  it("keeps the particles of an Italian or Dutch family name with it", () => {
    expect(guessNameParts("Maria De Luca")).toEqual({ givenName: "Maria", familyName: "De Luca" });
    expect(guessNameParts("Anna van der Berg")).toEqual({
      givenName: "Anna",
      familyName: "van der Berg",
    });
    expect(guessNameParts("Gian Marco della Rosa")).toEqual({
      givenName: "Gian Marco",
      familyName: "della Rosa",
    });
  });

  it("takes the last word as the family name and the rest as given names", () => {
    expect(guessNameParts("Maria Chiara Rossi")).toEqual({
      givenName: "Maria Chiara",
      familyName: "Rossi",
    });
    expect(guessNameParts("  Mario   Rossi ")).toEqual({ givenName: "Mario", familyName: "Rossi" });
  });

  it("never leaves the first name empty", () => {
    expect(guessNameParts("De Luca")).toEqual({ givenName: "De", familyName: "Luca" });
    expect(guessNameParts("Cher")).toEqual({ givenName: "Cher", familyName: "" });
    expect(guessNameParts("")).toEqual({ givenName: "", familyName: "" });
  });
});

describe("self-declared names", () => {
  it("accepts letters of any script, accents, apostrophes, hyphens and initials", () => {
    for (const value of ["José", "D'Angelo", "O’Brien", "Anne-Marie", "De Luca", "J. R.", "Zoë"])
      expect(namePartProblem(value, "first name")).toBeNull();
    for (const value of ["Ελένη", "Юлия", "李", "محمد", "می\u200Cخواهم"])
      expect(namePartProblem(value, "first name")).toBeNull();
  });

  it("refuses digits, symbols, emoji and stray separators", () => {
    // A joiner only between letters: a trailing one would be an invisible copy of "Ana".
    for (const value of [
      "R2D2",
      "Mario!",
      "Ana 😀",
      "-Ana",
      "Ana--Maria",
      "'s",
      "@admin",
      "Ana\u200C",
    ])
      expect(namePartProblem(value, "last name")).toMatch(/only letters/);
  });

  it("requires both parts and limits their length", () => {
    expect(namePartProblem("   ", "first name")).toBe("Enter your first name.");
    expect(namePartProblem("A".repeat(51), "last name")).toMatch(/at most 50/);
    expect(namePartProblem("A".repeat(50), "last name")).toBeNull();
  });

  it("is normalized before it's stored", () => {
    expect(personNameSchema.parse({ givenName: "  Maria  ", familyName: "De   Luca" })).toEqual({
      givenName: "Maria",
      familyName: "De Luca",
    });
    // A decomposed "é" is stored composed, so the same name is always the same string.
    expect(personNameSchema.parse({ givenName: "José", familyName: "Rossi" }).givenName).toBe(
      "José",
    );
    expect(personNameSchema.safeParse({ givenName: "", familyName: "Rossi" }).success).toBe(false);
  });
});

describe("names apps receive", () => {
  it("joins first and last name into `name`", () => {
    expect(joinName({ givenName: "Maria", familyName: "De Luca" })).toBe("Maria De Luca");
    expect(joinName({ givenName: "Cher", familyName: "" })).toBe("Cher");
  });

  it("sends the stored parts, not a split of `name`", () => {
    expect(nameClaims({ givenName: "Maria", familyName: "De Luca" })).toEqual({
      given_name: "Maria",
      family_name: "De Luca",
    });
    // An empty part is sent empty, so UserInfo can't fill it from a split of `name`.
    expect(nameClaims({ givenName: "Mary Jane", familyName: "" })).toEqual({
      given_name: "Mary Jane",
      family_name: "",
    });
    expect(nameClaims({ givenName: "", familyName: "" })).toEqual({});
  });

  it("calls only the directory's name verified", () => {
    const read = new Date();
    expect(isNameVerified({ nameSource: "entra", nameConfirmedAt: read })).toBe(true);
    expect(isNameVerified({ nameSource: "self", nameConfirmedAt: read })).toBe(false);
    // A guess the directory never supplied (backfill, or Graph unreachable) isn't verified.
    expect(isNameVerified({ nameSource: "entra", nameConfirmedAt: null })).toBe(false);
  });
});

describe("directory names", () => {
  it("reads Entra's claims or Graph's fields, normalized", () => {
    expect(directoryName(" Maria ", "De  Luca")).toEqual({
      givenName: "Maria",
      familyName: "De Luca",
    });
    expect(directoryName("Maria", null)).toEqual({ givenName: "Maria", familyName: "" });
    expect(directoryName(undefined, "")).toBeNull();
    expect(directoryName(42, {})).toBeNull();
  });
});

describe("confirming a name", () => {
  it("is asked only for a self-declared name never confirmed", () => {
    expect(needsNameConfirmation({ nameSource: "self", nameConfirmedAt: null })).toBe(true);
    expect(needsNameConfirmation({ nameSource: "self", nameConfirmedAt: new Date() })).toBe(false);
    expect(needsNameConfirmation({ nameSource: "entra", nameConfirmedAt: null })).toBe(false);
  });
});
