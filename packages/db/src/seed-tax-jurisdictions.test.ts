import { describe, expect, it } from "vitest";
import { buildDefaultTaxJurisdictionSeed } from "./seed-tax-jurisdictions";

describe("tax jurisdiction seed defaults", () => {
  it("covers US states, EU countries, and priority non-EU VAT jurisdictions", () => {
    const seed = buildDefaultTaxJurisdictionSeed();

    const usStates = seed.filter((entry) => entry.countryCode === "US");
    const euCountries = seed.filter((entry) => entry.tags.includes("eu_vat"));
    const explicit = new Map(seed.map((entry) => [entry.jurisdictionRefId, entry]));

    expect(usStates).toHaveLength(50);
    expect(euCountries).toHaveLength(27);
    expect(explicit.get("TAX-JUR-GB-VAT")?.officialWebsiteUrl).toBe("https://www.gov.uk/business-tax/vat");
    expect(explicit.get("TAX-JUR-DK-VAT")?.filingUrl).toBe(
      "https://skat.dk/en-us/businesses/vat/deadlines-filing-vat-returns-and-paying-vat",
    );
    expect(explicit.get("TAX-JUR-NO-VAT")?.paymentUrl).toBe(
      "https://www.skatteetaten.no/en/business-and-organisation/vat-and-duties/vat/paying-vat/",
    );
  });
});
