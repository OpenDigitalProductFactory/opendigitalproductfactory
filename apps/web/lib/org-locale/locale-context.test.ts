import { describe, expect, it } from "vitest";

import { resolveLocaleContext, type LocaleContextInputs } from "./locale-context";

const base: LocaleContextInputs = {
  viewerIsAdmin: false,
  previewCookie: null,
  principalLanguage: null,
  principalTimeZone: null,
  orgDefaultLanguage: null,
  acceptLanguage: null,
  orgSettings: { baseCurrency: "USD", locale: "en-US", countryCode: "US" },
  orgTimeZone: "America/Chicago",
};

describe("resolveLocaleContext — the chain (AC-CHAIN)", () => {
  it("defaults to en-US, ltr, the org timezone and currency when nothing is set", () => {
    expect(resolveLocaleContext(base)).toEqual({
      language: "en-US",
      formatLocale: "en-US",
      dir: "ltr",
      timeZone: "America/Chicago",
      displayCurrency: "USD",
      measurementSystem: "us",
    });
  });

  it("honours an admin's preview cookie first, including pseudo-locales", () => {
    const ctx = resolveLocaleContext({
      ...base,
      viewerIsAdmin: true,
      previewCookie: "ar-XB",
      principalLanguage: "en-US",
    });
    expect(ctx.language).toBe("ar-XB");
    expect(ctx.dir).toBe("rtl");
  });

  it("ignores a non-admin's preview cookie", () => {
    const ctx = resolveLocaleContext({ ...base, previewCookie: "ar-XB" });
    expect(ctx.language).toBe("en-US");
    expect(ctx.dir).toBe("ltr");
  });

  it("uses the Principal's language before the org default and the browser", () => {
    const ctx = resolveLocaleContext({
      ...base,
      principalLanguage: "en-US",
      orgDefaultLanguage: "es-MX",
      acceptLanguage: "fr",
    });
    expect(ctx.language).toBe("en-US");
  });

  it("does not honour a Principal preference for a locale that is only planned", () => {
    const ctx = resolveLocaleContext({ ...base, principalLanguage: "es-MX" });
    expect(ctx.language).toBe("en-US");
  });

  it("does not negotiate pseudo or planned locales from Accept-Language", () => {
    expect(resolveLocaleContext({ ...base, acceptLanguage: "ar-XB,es-MX" }).language).toBe("en-US");
  });

  it("negotiates Accept-Language against supported locales", () => {
    expect(resolveLocaleContext({ ...base, acceptLanguage: "en-GB,en;q=0.9" }).language).toBe("en-US");
  });
});

describe("resolveLocaleContext — formatting, time and units", () => {
  it("formats with the org's locale when the language was not chosen explicitly (English unchanged)", () => {
    const ctx = resolveLocaleContext({
      ...base,
      orgSettings: { baseCurrency: "GBP", locale: "en-GB", countryCode: "GB" },
    });
    expect(ctx.language).toBe("en-US");
    expect(ctx.formatLocale).toBe("en-GB");
    expect(ctx.displayCurrency).toBe("GBP");
    expect(ctx.measurementSystem).toBe("uk");
  });

  it("keeps org formatting under a pseudo-locale so only the copy changes", () => {
    const ctx = resolveLocaleContext({ ...base, viewerIsAdmin: true, previewCookie: "en-XA" });
    expect(ctx.formatLocale).toBe("en-US");
  });

  it("prefers the Principal's timezone, then the org's, then UTC; rejects invalid zones", () => {
    expect(resolveLocaleContext({ ...base, principalTimeZone: "Europe/Madrid" }).timeZone).toBe("Europe/Madrid");
    expect(resolveLocaleContext({ ...base, principalTimeZone: "Mars/Olympus" }).timeZone).toBe("America/Chicago");
    expect(resolveLocaleContext({ ...base, orgTimeZone: null }).timeZone).toBe("UTC");
  });

  it("derives metric for countries outside the US, Liberia, Myanmar and the UK", () => {
    const mx = resolveLocaleContext({
      ...base,
      orgSettings: { baseCurrency: "MXN", locale: "es-MX", countryCode: "MX" },
    });
    expect(mx.measurementSystem).toBe("metric");
    expect(mx.displayCurrency).toBe("MXN");
  });

  it("survives a missing OrgSettings row", () => {
    const ctx = resolveLocaleContext({ ...base, orgSettings: null, orgTimeZone: null });
    expect(ctx).toMatchObject({ language: "en-US", formatLocale: "en-US", displayCurrency: "USD", timeZone: "UTC" });
  });
});
