import { describe, expect, it } from "vitest";

import { isValidEmail, normalizeEmail } from "./email-format";

describe("normalizeEmail", () => {
  it("trims and lowercases", () => {
    expect(normalizeEmail("  Jane.Doe@Company.COM  ")).toBe("jane.doe@company.com");
  });

  it("leaves an already-normalized address unchanged", () => {
    expect(normalizeEmail("a@b.com")).toBe("a@b.com");
  });
});

describe("isValidEmail", () => {
  it.each([
    "jane@company.com",
    "a.b-c+tag@sub.example.co.uk",
  ])("accepts %s", (value) => {
    expect(isValidEmail(value)).toBe(true);
  });

  it.each([
    "",
    "   ",
    "no-at-sign",
    "missing@domain",
    "spaces in@email.com",
    "two@@at.com",
  ])("rejects %s", (value) => {
    expect(isValidEmail(value)).toBe(false);
  });

  it("rejects addresses longer than 320 chars", () => {
    const long = `${"a".repeat(320)}@b.com`;
    expect(isValidEmail(long)).toBe(false);
  });
});
