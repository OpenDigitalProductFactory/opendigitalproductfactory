import { describe, expect, it } from "vitest";

import { languageOptions, validateLocalePreferences } from "./locale-preferences";

describe("validateLocalePreferences (AC-PREFERENCE)", () => {
  it("accepts a supported language and a real IANA timezone", () => {
    expect(validateLocalePreferences({ language: "en-US", timeZone: "America/Mexico_City" }, false)).toEqual({
      ok: true,
      value: { preferredLanguage: "en-US", timeZone: "America/Mexico_City" },
    });
  });

  it("treats empty values as 'follow the organization' (null)", () => {
    expect(validateLocalePreferences({ language: "", timeZone: "" }, false)).toEqual({
      ok: true,
      value: { preferredLanguage: null, timeZone: null },
    });
  });

  it("lets admins choose a pseudo-locale but refuses it for everyone else", () => {
    expect(validateLocalePreferences({ language: "ar-XB", timeZone: null }, true).ok).toBe(true);
    expect(validateLocalePreferences({ language: "ar-XB", timeZone: null }, false)).toEqual({
      ok: false,
      error: "That language is not available yet.",
    });
  });

  it("refuses planned or unknown languages and invalid timezones", () => {
    expect(validateLocalePreferences({ language: "es-MX", timeZone: null }, true).ok).toBe(false);
    expect(validateLocalePreferences({ language: "xx-YY", timeZone: null }, true).ok).toBe(false);
    expect(validateLocalePreferences({ language: null, timeZone: "Mars/Olympus" }, false)).toEqual({
      ok: false,
      error: "That time zone is not recognized.",
    });
  });
});

describe("languageOptions", () => {
  it("offers supported locales to everyone and pseudo-locales only to admins", () => {
    expect(languageOptions(false).map((o) => o.tag)).toEqual(["en-US"]);
    expect(languageOptions(true).map((o) => o.tag)).toEqual(["en-US", "en-XA", "ar-XB"]);
  });
});
