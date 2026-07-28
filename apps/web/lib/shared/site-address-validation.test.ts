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
