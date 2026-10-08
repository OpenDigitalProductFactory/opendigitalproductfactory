import { describe, expect, it, vi } from "vitest";

import { serializeOrgAddress } from "@/lib/shared/org-address";

import { geocodeOrganizationAddress, geocodeSavedAddress, type OnSaveDb } from "./on-save";
import type { GeocodeInput, GeocodingProvider } from "./providers";

const NOW = new Date("2026-10-07T12:00:00Z");
const fetchImpl = vi.fn();

function provider(overrides: Partial<GeocodingProvider> = {}): GeocodingProvider {
  return {
    id: "census",
    enabled: true,
    batchSize: 1,
    minIntervalMs: 1000,
    geocode: vi.fn(async (inputs: readonly GeocodeInput[]) =>
      inputs.map((input) => ({ key: input.key, status: "found" as const, latitude: 30.2672, longitude: -97.7431, precision: "exact" as const })),
    ),
    ...overrides,
  };
}

type AddressFixture = Awaited<ReturnType<OnSaveDb["address"]["findUnique"]>>;

function db(address: AddressFixture, org: { id: string; address: unknown } | null = null) {
  return {
    address: {
      findUnique: vi.fn(async (_args: unknown) => address),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    organization: {
      findUnique: vi.fn(async () => org),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
  } satisfies OnSaveDb;
}

const ADDRESS: NonNullable<AddressFixture> = {
  id: "addr-1",
  addressLine1: "100 Congress Ave",
  postalCode: "78701",
  latitude: null,
  city: { name: "Austin", region: { name: "Texas", code: "TX", country: { iso2: "US" } } },
};

describe("geocodeSavedAddress", () => {
  it("sends nothing when the provider is not enabled (provider none)", async () => {
    const p = provider({ id: "none", enabled: false });
    const d = db(ADDRESS);
    expect(await geocodeSavedAddress(d, p, "addr-1", { fetchImpl, now: NOW })).toBe("skipped");
    expect(p.geocode).not.toHaveBeenCalled();
    expect(d.address.findUnique).not.toHaveBeenCalled();
  });

  it("stores a found point with the provider as source, only where coordinates are still empty", async () => {
    const p = provider();
    const d = db(ADDRESS);
    expect(await geocodeSavedAddress(d, p, "addr-1", { fetchImpl, now: NOW })).toBe("placed");
    expect(p.geocode).toHaveBeenCalledWith(
      [{ key: "addr-1", line1: "100 Congress Ave", city: "Austin", region: "TX", postalCode: "78701", countryCode: "US" }],
      { fetchImpl },
    );
    expect(d.address.updateMany).toHaveBeenCalledWith({
      where: { id: "addr-1", latitude: null },
      data: { latitude: 30.2672, longitude: -97.7431, validatedAt: NOW, validationSource: "census" },
    });
  });

  it("does not ask the provider for an address that already has coordinates", async () => {
    const p = provider();
    const d = db({ ...ADDRESS, latitude: "30.1" });
    expect(await geocodeSavedAddress(d, p, "addr-1", { fetchImpl })).toBe("skipped");
    expect(p.geocode).not.toHaveBeenCalled();
  });

  it("reports not-found without writing", async () => {
    const p = provider({ geocode: vi.fn(async () => [{ key: "addr-1", status: "not-found" as const }]) });
    const d = db(ADDRESS);
    expect(await geocodeSavedAddress(d, p, "addr-1", { fetchImpl })).toBe("not-found");
    expect(d.address.updateMany).not.toHaveBeenCalled();
  });

  it("reports skipped when a person placed the site while the lookup ran", async () => {
    const d = db(ADDRESS);
    d.address.updateMany.mockResolvedValueOnce({ count: 0 });
    expect(await geocodeSavedAddress(d, provider(), "addr-1", { fetchImpl })).toBe("skipped");
  });
});

describe("geocodeOrganizationAddress", () => {
  const ORG_ADDRESS = { line1: "100 Congress Ave", city: "Austin", region: "Texas", stateCode: "TX", postalCode: "78701", countryCode: "US", street: "100 Congress Ave" };

  it("writes the point into Organization.address with compare-and-set on the value read", async () => {
    const d = db(null, { id: "org-1", address: ORG_ADDRESS });
    expect(await geocodeOrganizationAddress(d, provider(), "org-1", { fetchImpl, now: NOW })).toBe("placed");
    expect(d.organization.updateMany).toHaveBeenCalledWith({
      where: { id: "org-1", address: { equals: ORG_ADDRESS } },
      data: {
        address: { ...ORG_ADDRESS, latitude: 30.2672, longitude: -97.7431, validationSource: "census", validatedAt: NOW.toISOString() },
      },
    });
  });

  it("leaves an organization that already has a point alone", async () => {
    const p = provider();
    const d = db(null, { id: "org-1", address: { ...ORG_ADDRESS, lat: 30, lng: -97 } });
    expect(await geocodeOrganizationAddress(d, p, "org-1", { fetchImpl })).toBe("skipped");
    expect(p.geocode).not.toHaveBeenCalled();
  });

  it("skips an address with no street or no country", async () => {
    const p = provider();
    expect(await geocodeOrganizationAddress(db(null, { id: "org-1", address: { location: "Austin, TX" } }), p, "org-1", { fetchImpl })).toBe("skipped");
    expect(p.geocode).not.toHaveBeenCalled();
  });
});

describe("serializeOrgAddress and the organization's point", () => {
  const stored = {
    line1: "100 Congress Ave", city: "Austin", region: "Texas", stateCode: "TX", countryCode: "US",
    latitude: 30.2672, longitude: -97.7431, validationSource: "census", validatedAt: NOW.toISOString(),
  };

  it("keeps a provider point while the address text is unchanged", () => {
    const out = serializeOrgAddress({ line1: "100 Congress Ave", city: "Austin", stateCode: "TX", countryCode: "US" }, stored);
    expect(out.latitude).toBe(30.2672);
    expect(out.validationSource).toBe("census");
  });

  it("drops a provider point when the address text changes", () => {
    const out = serializeOrgAddress({ line1: "500 Main St", city: "Dallas", stateCode: "TX", countryCode: "US" }, stored);
    expect(out.latitude).toBeUndefined();
    expect(out.longitude).toBeUndefined();
    expect(out.validationSource).toBeUndefined();
  });

  it("keeps a hand-entered or person-confirmed point when the address text changes", () => {
    const handEntered = { ...stored, validationSource: undefined };
    expect(serializeOrgAddress({ line1: "500 Main St", countryCode: "US" }, handEntered).latitude).toBe(30.2672);
    const pinned = { ...stored, validationSource: "manual-pin" };
    expect(serializeOrgAddress({ line1: "500 Main St", countryCode: "US" }, pinned).latitude).toBe(30.2672);
  });
});
