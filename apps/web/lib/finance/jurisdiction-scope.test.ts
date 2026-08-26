import { describe, expect, it } from "vitest";
import { jurisdictionCountryScope } from "./tax-remittance-service";

// The jurisdiction reference is a GLOBAL catalogue. Offering all of it to every
// install put 80 options in one control and showed a US business EU VAT
// authorities. Scope comes from the install's own identity (DI-89F317F406AA).

describe("jurisdictionCountryScope", () => {
  it("scopes to the install's home country", () => {
    expect(jurisdictionCountryScope({ homeCountryCode: "US" }, [])).toEqual({
      countryCode: { in: ["US"] },
    });
  });

  it("always keeps countries the org already registered in", () => {
    // A US seller with an existing EU VAT obligation must never find that
    // authority missing from the picker just because it is not their home.
    expect(jurisdictionCountryScope({ homeCountryCode: "US" }, ["DE", "FR"])).toEqual({
      countryCode: { in: ["DE", "FR", "US"] },
    });
  });

  it("does not narrow an install that has not declared where it operates", () => {
    // Filtering on an unknown would hide authorities the operator needs, which
    // is worse than showing too many.
    expect(jurisdictionCountryScope({ homeCountryCode: null }, [])).toBeUndefined();
    expect(jurisdictionCountryScope({ homeCountryCode: "   " }, [])).toBeUndefined();
    expect(jurisdictionCountryScope({}, [])).toBeUndefined();
  });

  it("normalises case and whitespace so 'us' and 'US' are one country", () => {
    expect(jurisdictionCountryScope({ homeCountryCode: " us " }, ["de"])).toEqual({
      countryCode: { in: ["DE", "US"] },
    });
  });

  it("does not duplicate the home country when it is also registered", () => {
    expect(jurisdictionCountryScope({ homeCountryCode: "GB" }, ["GB", "GB"])).toEqual({
      countryCode: { in: ["GB"] },
    });
  });
});
