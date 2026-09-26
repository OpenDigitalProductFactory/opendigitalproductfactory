import { describe, expect, it } from "vitest";

import { DEFAULT_LOCALE, LOCALES, findLocale, localesWithStatus } from "./locales";
import { direction, isRtl } from "./direction";
import { negotiateLocale } from "./negotiate";

describe("locale registry", () => {
  it("holds only canonical BCP-47 tags", () => {
    for (const entry of LOCALES) {
      expect(Intl.getCanonicalLocales(entry.tag)[0]).toBe(entry.tag);
    }
  });

  it("derives every entry's direction from its script, never a stored flag", () => {
    for (const entry of LOCALES) {
      const script = new Intl.Locale(entry.tag).maximize().script;
      const expected = script === "Arab" || script === "Hebr" ? "rtl" : "ltr";
      expect(direction(entry.tag)).toBe(expected);
    }
  });

  it("supports only en-US today; Spanish and Arabic are planned, pseudo-locales are pseudo", () => {
    expect(localesWithStatus("supported").map((l) => l.tag)).toEqual(["en-US"]);
    expect(localesWithStatus("pseudo").map((l) => l.tag)).toEqual(["en-XA", "ar-XB"]);
    expect(localesWithStatus("planned").map((l) => l.tag)).toEqual(
      expect.arrayContaining(["es-419", "es-MX", "es-US", "ar"]),
    );
    expect(DEFAULT_LOCALE).toBe("en-US");
  });

  it("finds entries case-insensitively and returns null for unknown tags", () => {
    expect(findLocale("EN-us")?.tag).toBe("en-US");
    expect(findLocale("fr-FR")).toBeNull();
    expect(findLocale("")).toBeNull();
  });
});

describe("direction", () => {
  it("is rtl for right-to-left scripts, including the ar-XB pseudo-locale", () => {
    for (const tag of ["ar", "ar-XB", "he", "fa", "ur-PK", "ps", "dv", "yi"]) {
      expect(isRtl(tag)).toBe(true);
    }
  });

  it("is ltr for left-to-right scripts and for malformed input", () => {
    for (const tag of ["en-US", "en-XA", "es-MX", "ja", "zh-Hant", "not a tag", ""]) {
      expect(direction(tag)).toBe("ltr");
    }
  });
});

describe("negotiateLocale", () => {
  const supported = ["en-US", "es-419", "es-MX"];

  it("picks the highest-weighted exact match", () => {
    expect(negotiateLocale("es-MX,es;q=0.9,en;q=0.8", supported)).toBe("es-MX");
  });

  it("falls back from a Latin American regional Spanish to es-419, then to es", () => {
    expect(negotiateLocale("es-AR", supported)).toBe("es-419");
    expect(negotiateLocale("es-ES", ["en-US", "es"])).toBe("es");
  });

  it("matches a bare language to the first supported locale of that language", () => {
    expect(negotiateLocale("es", ["en-US", "es-MX"])).toBe("es-MX");
  });

  it("honours q-values over header order and skips q=0", () => {
    expect(negotiateLocale("en;q=0.2,es-MX;q=0.9", supported)).toBe("es-MX");
    expect(negotiateLocale("es-MX;q=0,en", supported)).toBe("en-US");
  });

  it("returns null when nothing matches or the header is absent or malformed", () => {
    expect(negotiateLocale("fr-FR,de", supported)).toBeNull();
    expect(negotiateLocale(null, supported)).toBeNull();
    expect(negotiateLocale(";;;q=bad,,", supported)).toBeNull();
  });

  it("negotiates only among the locales it is given", () => {
    expect(negotiateLocale("es-MX", ["en-US"])).toBeNull();
  });
});
