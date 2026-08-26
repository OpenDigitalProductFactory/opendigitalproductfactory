// Jurisdiction-aware mileage rate resolution (DI-5E5AFE040A1F).
//
// These fixtures are deliberately synthetic. Real statutory mileage rates are
// operator-supplied, source-cited reference data (BI-4EB27955); inventing
// plausible ones in a test is how a fabricated rate ends up quoted as fact.

import { describe, expect, it } from "vitest";
import { normaliseCountryCode, resolveRateForTrip, type ResolvableRate } from "./rates";

function rate(over: Partial<ResolvableRate> & { id: string }): ResolvableRate {
  return {
    purposeKind: "business",
    amountPerMile: 1,
    currency: "USD",
    effectiveFrom: new Date("2026-01-01"),
    effectiveTo: null,
    isOrgOverride: false,
    jurisdictionCountryCode: null,
    ...over,
  };
}

const ON = new Date("2026-06-15");

describe("resolveRateForTrip", () => {
  it("prices a drive on the country it happened in", () => {
    const rates = [
      rate({ id: "us", jurisdictionCountryCode: "US", amountPerMile: 0.7 }),
      rate({ id: "mx", jurisdictionCountryCode: "MX", amountPerMile: 0.3 }),
    ];
    const got = resolveRateForTrip(rates, ON, { tripCountryCode: "MX", employeeCountryCode: "US" });
    expect(got?.id).toBe("mx");
  });

  it("falls back to the employee's country of record when the org has no plan there", () => {
    // The classic case: a US employee drives in Canada, where the org has no plan.
    const rates = [rate({ id: "us", jurisdictionCountryCode: "US" })];
    const got = resolveRateForTrip(rates, ON, { tripCountryCode: "CA", employeeCountryCode: "US" });
    expect(got?.id).toBe("us");
  });

  it("falls back to the employee's country when the device derived no country", () => {
    const rates = [rate({ id: "us", jurisdictionCountryCode: "US" })];
    const got = resolveRateForTrip(rates, ON, { tripCountryCode: null, employeeCountryCode: "US" });
    expect(got?.id).toBe("us");
  });

  it("falls back to an unscoped plan when neither country has one", () => {
    const rates = [
      rate({ id: "global" }),
      rate({ id: "gb", jurisdictionCountryCode: "GB" }),
    ];
    const got = resolveRateForTrip(rates, ON, { tripCountryCode: "MX", employeeCountryCode: "US" });
    expect(got?.id).toBe("global");
  });

  it("returns null rather than a wrong-country rate when nothing applies", () => {
    // Never zero-fill and never reach for a rate from the wrong jurisdiction:
    // an unpriceable trip must surface as unpriceable.
    const rates = [rate({ id: "gb", jurisdictionCountryCode: "GB", effectiveFrom: new Date("2030-01-01") })];
    expect(resolveRateForTrip(rates, ON, { tripCountryCode: "GB" })).toBeNull();
  });

  it("does not let an org override in the wrong country outrank the right country's rate", () => {
    // The bug a single flat sort would introduce: isOrgOverride wins WITHIN a
    // jurisdiction, never across one.
    const rates = [
      rate({ id: "us-override", jurisdictionCountryCode: "US", isOrgOverride: true, amountPerMile: 9 }),
      rate({ id: "mx-statutory", jurisdictionCountryCode: "MX", amountPerMile: 0.3 }),
    ];
    const got = resolveRateForTrip(rates, ON, { tripCountryCode: "MX", employeeCountryCode: "US" });
    expect(got?.id).toBe("mx-statutory");
  });

  it("still prefers an org override within the winning country", () => {
    const rates = [
      rate({ id: "mx-statutory", jurisdictionCountryCode: "MX" }),
      rate({ id: "mx-override", jurisdictionCountryCode: "MX", isOrgOverride: true }),
    ];
    const got = resolveRateForTrip(rates, ON, { tripCountryCode: "MX" });
    expect(got?.id).toBe("mx-override");
  });

  it("still prefers the latest effectiveFrom within the winning country", () => {
    const rates = [
      rate({ id: "old", jurisdictionCountryCode: "US", effectiveFrom: new Date("2026-01-01") }),
      rate({ id: "new", jurisdictionCountryCode: "US", effectiveFrom: new Date("2026-06-01") }),
    ];
    expect(resolveRateForTrip(rates, ON, { tripCountryCode: "US" })?.id).toBe("new");
  });

  it("prices a trip driven on the day a rate opens, and not the day it closes", () => {
    const rates = [
      rate({
        id: "window",
        jurisdictionCountryCode: "US",
        effectiveFrom: new Date("2026-06-15"),
        effectiveTo: new Date("2026-06-20"), // clock-bomb-guard: allow resolveRateForTrip compares only against the `on` date passed in, never the system clock
      }),
    ];
    expect(resolveRateForTrip(rates, new Date("2026-06-15"), { tripCountryCode: "US" })?.id).toBe("window");
    expect(resolveRateForTrip(rates, new Date("2026-06-20"), { tripCountryCode: "US" })).toBeNull();
  });

  it("matches country codes case- and whitespace-insensitively", () => {
    // A stored " us " must not silently miss and price on the fallback.
    const rates = [rate({ id: "us", jurisdictionCountryCode: " us " })];
    expect(resolveRateForTrip(rates, ON, { tripCountryCode: "US" })?.id).toBe("us");
  });

  it("honours purpose alongside jurisdiction", () => {
    const rates = [
      rate({ id: "us-business", jurisdictionCountryCode: "US", purposeKind: "business" }),
      rate({ id: "us-medical", jurisdictionCountryCode: "US", purposeKind: "medical" }),
    ];
    const got = resolveRateForTrip(rates, ON, { tripCountryCode: "US", purpose: "medical" });
    expect(got?.id).toBe("us-medical");
  });
});

describe("normaliseCountryCode", () => {
  it("uppercases, trims, and treats blank as unknown", () => {
    expect(normaliseCountryCode(" mx ")).toBe("MX");
    expect(normaliseCountryCode("")).toBeNull();
    expect(normaliseCountryCode("   ")).toBeNull();
    expect(normaliseCountryCode(null)).toBeNull();
    expect(normaliseCountryCode(undefined)).toBeNull();
  });
});
