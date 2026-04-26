import { describe, expect, it } from "vitest";
import { normalizeLocalityName } from "./normalize";

describe("normalizeLocalityName", () => {
  it("normalizes case, diacritics, Unicode composition, and whitespace", () => {
    expect(normalizeLocalityName("  São   Tomé  ")).toBe("sao tome");
    expect(normalizeLocalityName("São Tomé")).toBe("sao tome");
  });

  it("keeps meaningful punctuation inside names", () => {
    expect(normalizeLocalityName("Winston-Salem")).toBe("winston-salem");
    expect(normalizeLocalityName("St. John's")).toBe("st. john's");
  });
});
