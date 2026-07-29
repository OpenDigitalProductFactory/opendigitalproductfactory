import { describe, expect, it } from "vitest";

import {
  coercePhoneCountry,
  formatPhoneAsYouType,
  formatPhoneDisplay,
  unmaskInvalidPhone,
  isValidPhone,
  toE164,
} from "./phone";

describe("formatPhoneAsYouType", () => {
  it("formats a US number progressively", () => {
    expect(formatPhoneAsYouType("415", "US")).toBe("(415)");
    expect(formatPhoneAsYouType("4155551234", "US")).toBe("(415) 555-1234");
  });

  it("honors a leading + as international regardless of country", () => {
    expect(formatPhoneAsYouType("+442079460000", "US")).toBe("+44 20 7946 0000");
  });

  it("formats a GB national number when country is GB", () => {
    expect(formatPhoneAsYouType("02079460000", "GB")).toBe("020 7946 0000");
  });

  it("returns empty string for empty input", () => {
    expect(formatPhoneAsYouType("", "US")).toBe("");
  });
});

describe("toE164", () => {
  it("normalizes a formatted US number to E.164", () => {
    expect(toE164("(415) 555-1234", "US")).toBe("+14155551234");
  });

  it("returns null for incomplete numbers", () => {
    expect(toE164("415", "US")).toBeNull();
  });

  it("returns null for empty input", () => {
    expect(toE164("", "US")).toBeNull();
  });
});

describe("isValidPhone", () => {
  it("accepts a complete US number", () => {
    expect(isValidPhone("(415) 555-1234", "US")).toBe(true);
  });

  it("rejects an incomplete number", () => {
    expect(isValidPhone("415", "US")).toBe(false);
  });

  it("rejects empty input", () => {
    expect(isValidPhone("", "US")).toBe(false);
  });
});

describe("coercePhoneCountry", () => {
  it("accepts and upper-cases a supported ISO-2 code", () => {
    expect(coercePhoneCountry("gb")).toBe("GB");
    expect(coercePhoneCountry(" us ")).toBe("US");
  });

  it("returns null for unset or unrecognized values", () => {
    expect(coercePhoneCountry(null)).toBeNull();
    expect(coercePhoneCountry(undefined)).toBeNull();
    expect(coercePhoneCountry("")).toBeNull();
    expect(coercePhoneCountry("ZZ")).toBeNull();
    expect(coercePhoneCountry("United States")).toBeNull();
  });
});

describe("unmaskInvalidPhone", () => {
  it("strips the wrong-confidence mask from an incomplete number (BI-7639D394)", () => {
    // A guest typing the local-style "555-0142" gets live-masked to
    // "(555) 014-2" — on blur that must degrade to honest digits.
    expect(unmaskInvalidPhone("(555) 014-2", "US")).toBe("5550142");
  });

  it("keeps a valid number formatted", () => {
    expect(unmaskInvalidPhone("(415) 555-1234", "US")).toBe("(415) 555-1234");
  });

  it("preserves a leading + on invalid international fragments", () => {
    expect(unmaskInvalidPhone("+44 20", "US")).toBe("+4420");
  });

  it("passes through empty and digit-free values", () => {
    expect(unmaskInvalidPhone("", "US")).toBe("");
    expect(unmaskInvalidPhone("ext.", "US")).toBe("ext.");
  });
});

describe("formatPhoneDisplay", () => {
  it("formats a stored E.164 number for display", () => {
    expect(formatPhoneDisplay("+14155551234", "US")).toBe("(415) 555-1234");
  });

  it("returns input unchanged when unparseable", () => {
    expect(formatPhoneDisplay("not a phone", "US")).toBe("not a phone");
  });

  it("returns empty string for null/empty", () => {
    expect(formatPhoneDisplay(null, "US")).toBe("");
    expect(formatPhoneDisplay("", "US")).toBe("");
  });
});
