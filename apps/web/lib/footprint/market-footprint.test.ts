import { describe, expect, it } from "vitest";

import { localesWithStatus } from "@dpf/i18n";

import {
  buildMarketFootprint,
  customerShadeStep,
  languageFitFor,
  OFFICIAL_LANGUAGE_COUNTRIES,
  registryLanguages,
} from "./market-footprint";

describe("buildMarketFootprint", () => {
  it("unions sellsTo and operatesIn as target markets, case-insensitively", () => {
    const result = buildMarketFootprint({
      targetMarkets: [["us", "gb"], ["US", "de"]],
      accounts: [],
      deploymentSites: [],
    });
    expect(result.targetMarketCount).toBe(3);
    expect(result.countries.find((c) => c.isoA2 === "DE")?.targetMarket).toBe(true);
    expect(result.countries.find((c) => c.isoA2 === "US")?.targetMarket).toBe(true);
  });

  it("counts an account once per country even with several sites there", () => {
    const result = buildMarketFootprint({
      targetMarkets: [],
      accounts: [
        { accountId: "a1", siteCountries: ["US", "US", "CA"] },
        { accountId: "a2", siteCountries: ["us"] },
      ],
      deploymentSites: [],
    });
    expect(result.countries.find((c) => c.isoA2 === "US")?.customerCount).toBe(2);
    expect(result.countries.find((c) => c.isoA2 === "CA")?.customerCount).toBe(1);
    expect(result.placedCustomers).toBe(2);
    expect(result.unplacedCustomers).toBe(0);
  });

  it("reports accounts with no site or no country as unplaced, never dropping them", () => {
    const result = buildMarketFootprint({
      targetMarkets: [],
      accounts: [
        { accountId: "a1", siteCountries: [] },
        { accountId: "a2", siteCountries: [null] },
        { accountId: "a3", siteCountries: ["FR"] },
      ],
      deploymentSites: [],
    });
    expect(result.unplacedCustomers).toBe(2);
    expect(result.placedCustomers).toBe(1);
  });

  it("counts deployment sites per country", () => {
    const result = buildMarketFootprint({
      targetMarkets: [],
      accounts: [],
      deploymentSites: [{ siteId: "s1", country: "AU" }, { siteId: "s2", country: "AU" }, { siteId: "s3", country: null }],
    });
    expect(result.countries.find((c) => c.isoA2 === "AU")?.deploymentCount).toBe(2);
    expect(result.deploymentCount).toBe(2);
    expect(result.unplacedDeployments).toBe(1);
  });

  it("marks language fit from the locale registry", () => {
    const result = buildMarketFootprint({ targetMarkets: [["JP", "IE", "MX"]], accounts: [], deploymentSites: [] });
    expect(result.countries.find((c) => c.isoA2 === "IE")?.languageFit).toBe("supported");
    expect(result.countries.find((c) => c.isoA2 === "MX")?.languageFit).toBe("planned");
    expect(result.countries.find((c) => c.isoA2 === "JP")?.languageFit).toBe("none");
  });

  it("only lists countries with something to show, sorted by customers then name", () => {
    const result = buildMarketFootprint({
      targetMarkets: [["NZ"]],
      accounts: [{ accountId: "a", siteCountries: ["BR"] }, { accountId: "b", siteCountries: ["BR"] }, { accountId: "c", siteCountries: ["AR"] }],
      deploymentSites: [],
    });
    expect(result.countries.map((c) => c.isoA2)).toEqual(["BR", "AR", "NZ"]);
    expect(result.countries[0].name).toBe("Brazil");
  });

  it("is empty but well-formed with no data", () => {
    const result = buildMarketFootprint({ targetMarkets: [], accounts: [], deploymentSites: [] });
    expect(result.countries).toEqual([]);
    expect(result.hasAnyData).toBe(false);
  });
});

describe("customerShadeStep", () => {
  it("maps counts onto five steps relative to the busiest country", () => {
    expect(customerShadeStep(0, 10)).toBe(0);
    expect(customerShadeStep(1, 10)).toBe(1);
    expect(customerShadeStep(10, 10)).toBe(5);
    expect(customerShadeStep(1, 1)).toBe(5);
  });
});

describe("languageFitFor", () => {
  it("follows the registry: English supported, Spanish and Arabic planned", () => {
    expect(languageFitFor("GB")).toEqual({ fit: "supported", languages: ["en"] });
    expect(languageFitFor("us")).toEqual({ fit: "supported", languages: ["en"] });
    expect(languageFitFor("AR").fit).toBe("planned");
    expect(languageFitFor("SA")).toEqual({ fit: "planned", languages: ["ar"] });
    expect(languageFitFor("FR")).toEqual({ fit: "none", languages: [] });
  });

  it("covers every language the registry supports or plans", () => {
    const { supported, planned } = registryLanguages();
    for (const language of [...supported, ...planned]) {
      expect(OFFICIAL_LANGUAGE_COUNTRIES[language], `no country table for "${language}"`).toBeDefined();
    }
    expect(localesWithStatus("supported").length).toBeGreaterThan(0);
  });
});
