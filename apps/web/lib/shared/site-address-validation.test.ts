import { afterEach, describe, expect, it, vi } from "vitest";
import {
  rememberValidatedSiteAddressForTests,
  resetValidatedSiteAddressCacheForTests,
  resolveValidatedSiteAddress,
  searchValidatedSiteAddresses,
} from "./site-address-validation";

afterEach(() => {
  resetValidatedSiteAddressCacheForTests();
  vi.restoreAllMocks();
});

describe("site-address-validation", () => {
  it("returns empty for short queries without calling the provider", async () => {
    const fetchImpl = vi.fn();
    await expect(searchValidatedSiteAddresses("ab", { fetchImpl })).resolves.toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("maps Nominatim hits and resolves them from the search cache", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [
        {
          place_id: 991122,
          display_name: "123 Main St, Dallas, Texas 75201, United States",
          lat: "32.7767",
          lon: "-96.7970",
          address: {
            house_number: "123",
            road: "Main St",
            city: "Dallas",
            state: "Texas",
            state_code: "TX",
            postcode: "75201",
            country: "United States",
            country_code: "us",
          },
        },
      ],
    });

    const results = await searchValidatedSiteAddresses("123 Main Dallas", { fetchImpl });
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      providerRef: "nominatim:991122",
      addressLine1: "123 Main St",
      city: "Dallas",
      region: "Texas",
      regionCode: "TX",
      countryCode: "US",
      postalCode: "75201",
      validationSource: "nominatim",
    });

    const resolved = await resolveValidatedSiteAddress("nominatim:991122");
    expect(resolved.addressLine1).toBe("123 Main St");
    expect(resolved.latitude).toBeCloseTo(32.7767);
  });

  it("skips incomplete Nominatim rows", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [
        {
          place_id: 1,
          address: {
            road: "Main St",
            // missing city / postal / country
            state: "Texas",
          },
        },
      ],
    });

    await expect(
      searchValidatedSiteAddresses("Main St", { fetchImpl }),
    ).resolves.toEqual([]);
  });

  it("throws a clear error when resolve misses the cache", async () => {
    await expect(resolveValidatedSiteAddress("missing-ref")).rejects.toThrow(/search again/i);
  });

  it("resolves test-seeded candidates without a network call", async () => {
    rememberValidatedSiteAddressForTests({
      providerRef: "test:1",
      label: "1 Test Rd",
      addressLine1: "1 Test Rd",
      addressLine2: null,
      city: "Austin",
      region: "Texas",
      regionCode: "TX",
      country: "United States",
      countryCode: "US",
      postalCode: "78701",
      latitude: 30.2,
      longitude: -97.7,
      precision: "rooftop",
      validationSource: "test",
    });

    await expect(resolveValidatedSiteAddress("test:1")).resolves.toMatchObject({
      city: "Austin",
      postalCode: "78701",
    });
  });
});

// OSMF Nominatim usage policy (BI-3099EACD):
// https://operations.osmfoundation.org/policies/nominatim/
describe("Nominatim usage policy", () => {
  const ok = () => vi.fn().mockResolvedValue({ ok: true, json: async () => [] });

  it("answers a repeated query from the cache instead of calling Nominatim again", async () => {
    const fetchImpl = ok();
    const sleep = vi.fn(async () => {});
    await searchValidatedSiteAddresses("123 Main St Dallas", { fetchImpl, sleep });
    await searchValidatedSiteAddresses("  123   main st DALLAS ", { fetchImpl, sleep });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("spaces calls at least one second apart across concurrent searches", async () => {
    let clock = 10_000;
    const now = () => clock;
    const waits: number[] = [];
    const sleep = vi.fn(async (ms: number) => { waits.push(ms); clock += ms; });
    const fetchImpl = ok();
    await Promise.all([
      searchValidatedSiteAddresses("1 First Street", { fetchImpl, now, sleep }),
      searchValidatedSiteAddresses("2 Second Street", { fetchImpl, now, sleep }),
      searchValidatedSiteAddresses("3 Third Street", { fetchImpl, now, sleep }),
    ]);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(waits).toEqual([1000, 1000]);
  });

  it("identifies the application and how to reach it", async () => {
    const fetchImpl = ok();
    await searchValidatedSiteAddresses("10 Downing Street London", { fetchImpl, sleep: async () => {} });
    const headers = fetchImpl.mock.calls[0][1].headers as Record<string, string>;
    expect(headers["User-Agent"]).toMatch(/^OpenDigitalProductFactory\/site-address-validation \(\+https:\/\/github\.com\/OpenDigitalProductFactory\/opendigitalproductfactory\)$/);
  });
});
