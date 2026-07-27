import { describe, expect, it } from "vitest";
import {
  ADDRESS_VALIDATION_ONE_ACTIVE_POLICY,
  ADDRESS_VALIDATION_PROVIDERS,
  describeAddressValidationSetup,
  suggestProviderForGeography,
} from "./address-validation-provider-guidance";

describe("address-validation-provider-guidance (BI-SITE-5E6A18)", () => {
  it("lists Smarty, Mapbox, and Nominatim with one-active policy", () => {
    expect(ADDRESS_VALIDATION_PROVIDERS.map((p) => p.id)).toEqual([
      "smarty",
      "mapbox",
      "nominatim",
    ]);
    expect(ADDRESS_VALIDATION_ONE_ACTIVE_POLICY.toLowerCase()).toContain("one commercial");
  });

  it("suggests Smarty for US and Mapbox for other countries", () => {
    expect(suggestProviderForGeography({ primaryCountry: "US" })).toBe("smarty");
    expect(suggestProviderForGeography({ primaryCountry: "United States" })).toBe("smarty");
    expect(suggestProviderForGeography({ primaryCountry: "CA" })).toBe("mapbox");
    expect(suggestProviderForGeography({})).toBe("smarty");
  });

  it("describes setup status for missing, partial, and ready states", () => {
    expect(
      describeAddressValidationSetup({
        commercialProviderDetected: false,
        siteLookupReady: false,
      }).nextStep,
    ).toMatch(/Smarty|Mapbox/);

    expect(
      describeAddressValidationSetup({
        commercialProviderDetected: true,
        siteLookupReady: false,
      }).headline,
    ).toMatch(/not wired/i);

    expect(
      describeAddressValidationSetup({
        commercialProviderDetected: true,
        siteLookupReady: true,
      }).headline,
    ).toMatch(/ready/i);
  });
});
