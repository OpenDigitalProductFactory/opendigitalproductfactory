import { describe, expect, it } from "vitest";
import { buildDefaultTaxJurisdictionSeed } from "./seed-tax-jurisdictions";

describe("tax jurisdiction seed defaults", () => {
  it("covers US states, EU countries, and priority non-EU VAT jurisdictions", () => {
    const seed = buildDefaultTaxJurisdictionSeed();

    const usStates = seed.filter(
      (entry) => entry.countryCode === "US" && entry.authorityType === "state",
    );
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

  it("seeds the US federal employment-tax authority alongside the states", () => {
    const seed = buildDefaultTaxJurisdictionSeed();
    const federal = seed.find((e) => e.jurisdictionRefId === "TAX-JUR-US-FEDERAL");

    // Payroll tax has no home without it: the spine had 50 states, EU and GB,
    // and no national authority to file a 941 against.
    expect(federal).toBeDefined();
    expect(federal?.authorityName).toBe("Internal Revenue Service");
    expect(federal?.taxTypes).toEqual(
      expect.arrayContaining(["payroll_withholding", "fica", "futa"]),
    );
    // Deposit cadence is assigned by lookback, so semiweekly must be offerable.
    expect(federal?.cadenceHints).toContain("semiweekly");
  });

  it("declares payroll tax types on states, minus wage withholding where none exists", () => {
    const seed = buildDefaultTaxJurisdictionSeed();
    const byCode = new Map(
      seed
        .filter((e) => e.countryCode === "US" && e.authorityType === "state")
        .map((e) => [e.stateProvinceCode, e]),
    );

    // Every state runs unemployment insurance.
    for (const code of ["CA", "TX", "NY", "FL"]) {
      expect(byCode.get(code)?.taxTypes).toContain("suta");
    }

    // California withholds wage income tax; Texas and Florida do not. Seeding
    // payroll_withholding for them would assert an obligation the business
    // does not owe.
    expect(byCode.get("CA")?.taxTypes).toContain("payroll_withholding");
    expect(byCode.get("TX")?.taxTypes).not.toContain("payroll_withholding");
    expect(byCode.get("FL")?.taxTypes).not.toContain("payroll_withholding");

    // Sales tax is unchanged by this addition.
    expect(byCode.get("CA")?.taxTypes).toContain("sales_tax");
  });
});
