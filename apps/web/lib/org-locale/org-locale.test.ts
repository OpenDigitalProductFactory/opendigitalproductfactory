import { describe, expect, it } from "vitest";

import {
  DEFAULT_LOCALE_CURRENCY,
  deriveLocaleCurrencyFromCountry,
  formatMoney,
  localeForCurrency,
  resolveOrgBaseCurrency,
  resolveOrgLocale,
  type OrgLocaleClient,
} from "./org-locale";

describe("deriveLocaleCurrencyFromCountry", () => {
  it("maps common operator countries to their currency + locale", () => {
    expect(deriveLocaleCurrencyFromCountry("US")).toEqual({ currency: "USD", locale: "en-US" });
    expect(deriveLocaleCurrencyFromCountry("GB")).toEqual({ currency: "GBP", locale: "en-GB" });
    expect(deriveLocaleCurrencyFromCountry("AU")).toEqual({ currency: "AUD", locale: "en-AU" });
    expect(deriveLocaleCurrencyFromCountry("DE")).toEqual({ currency: "EUR", locale: "de-DE" });
  });

  it("is case- and whitespace-insensitive", () => {
    expect(deriveLocaleCurrencyFromCountry(" us ")).toEqual({ currency: "USD", locale: "en-US" });
    expect(deriveLocaleCurrencyFromCountry("gb")).toEqual({ currency: "GBP", locale: "en-GB" });
  });

  it("falls back to the neutral default for unknown/empty country", () => {
    expect(deriveLocaleCurrencyFromCountry(null)).toEqual(DEFAULT_LOCALE_CURRENCY);
    expect(deriveLocaleCurrencyFromCountry("")).toEqual(DEFAULT_LOCALE_CURRENCY);
    expect(deriveLocaleCurrencyFromCountry("ZZ")).toEqual(DEFAULT_LOCALE_CURRENCY);
  });
});

describe("formatMoney", () => {
  it("formats in the currency's own locale by default (no more en-GB for USD)", () => {
    expect(formatMoney(1234, "USD")).toBe("$1,234.00");
    expect(formatMoney(1234, "GBP")).toBe("£1,234.00");
  });

  it("honours an explicit locale", () => {
    // en-US grouping with a USD symbol regardless of caller default.
    expect(formatMoney(1000000, "USD", "en-US")).toBe("$1,000,000.00");
  });

  // Money keeps the currency's ISO-4217 minor units unless a caller opts out.
  // Rounding to whole units by default dropped cents from every amount routed
  // through the shared formatter (BI-6030131C).
  it("keeps the currency's minor units by default", () => {
    expect(formatMoney(1234.5, "USD")).toBe("$1,234.50");
    expect(formatMoney(1234.5, "JPY", "en-US")).toBe("¥1,235");
    expect(formatMoney(1.2345, "BHD", "en-US")).toBe("BHD 1.235");
  });

  it("rounds to whole units only when a caller asks for it", () => {
    expect(formatMoney(1234.56, "USD", null, { maximumFractionDigits: 0 })).toBe("$1,235");
    expect(formatMoney(1234.5, "USD", "en-US", { maximumFractionDigits: 2 })).toBe("$1,234.50");
  });

  it("emits a bare grouped number when the currency is unknown", () => {
    expect(formatMoney(1500, null)).toBe("1,500");
  });

  it("falls back to a bare number for an invalid ISO currency code", () => {
    expect(formatMoney(1500, "NOTREAL")).toBe("1,500");
  });
});

describe("localeForCurrency", () => {
  it("maps a currency to a display locale, else en-US", () => {
    expect(localeForCurrency("GBP")).toBe("en-GB");
    expect(localeForCurrency("EUR")).toBe("en-IE");
    expect(localeForCurrency(null)).toBe("en-US");
    expect(localeForCurrency("ZZZ")).toBe("en-US");
  });
});

describe("resolveOrgLocale", () => {
  const client = (row: unknown): OrgLocaleClient => ({
    orgSettings: { findFirst: async () => row as never },
  });

  it("returns the default when there is no settings row", async () => {
    expect(await resolveOrgLocale(client(null))).toEqual({ currency: "USD", locale: "en-US", countryCode: null });
  });

  it("uses the operator-set baseCurrency + locale", async () => {
    const out = await resolveOrgLocale(client({ baseCurrency: "USD", locale: "en-US", countryCode: "US" }));
    expect(out).toEqual({ currency: "USD", locale: "en-US", countryCode: "US" });
  });

  it("derives from countryCode when currency/locale are blank", async () => {
    const out = await resolveOrgLocale(client({ baseCurrency: "", locale: "", countryCode: "au" }));
    expect(out).toEqual({ currency: "AUD", locale: "en-AU", countryCode: "AU" });
  });

  it("never throws when the query fails — degrades to the default and reports it", async () => {
    const failing: OrgLocaleClient = {
      orgSettings: { findFirst: async () => { throw new Error("db down"); } },
    };
    let failure: unknown;
    expect(
      await resolveOrgLocale(failing, {
        onReadFailure: (error) => {
          failure = error;
        },
      }),
    ).toEqual({ currency: "USD", locale: "en-US", countryCode: null });
    expect(failure).toBeInstanceOf(Error);
  });
});

describe("resolveOrgBaseCurrency", () => {
  const db = (row: { baseCurrency?: string | null; countryCode?: string | null } | null): OrgLocaleClient => ({
    orgSettings: { findFirst: async () => row },
  });

  // Every "no currency given" path uses this one answer, so an install that is
  // not in the UK never has GBP invented for it (BI-6030131C).
  it("returns the workspace's own base currency", async () => {
    expect(await resolveOrgBaseCurrency(db({ baseCurrency: "MXN" }))).toBe("MXN");
  });

  it("derives from the country when no currency is set", async () => {
    expect(await resolveOrgBaseCurrency(db({ baseCurrency: null, countryCode: "CA" }))).toBe("CAD");
  });

  it("falls back to USD when there is no settings row, never GBP", async () => {
    expect(await resolveOrgBaseCurrency(db(null))).toBe("USD");
  });
});
