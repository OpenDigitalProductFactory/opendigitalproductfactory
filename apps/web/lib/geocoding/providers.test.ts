import { describe, expect, it, vi } from "vitest";

import { parseGeocodingConfig, resolveGeocodingProvider, type GeocodeInput } from "./providers";

const austin: GeocodeInput = {
  key: "addr-1",
  line1: "1100 Congress Ave",
  city: "Austin",
  region: "TX",
  postalCode: "78701",
  countryCode: "US",
};
const paris: GeocodeInput = { key: "addr-2", line1: "1 Rue de Rivoli", city: "Paris", region: "", postalCode: "75001", countryCode: "FR" };

function json(body: unknown) {
  return vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });
}

describe("parseGeocodingConfig", () => {
  it("defaults to none and rejects unknown or unsafe settings", () => {
    expect(parseGeocodingConfig(undefined)).toEqual({ provider: "none" });
    expect(parseGeocodingConfig({ provider: "google" })).toEqual({ provider: "none" });
    expect(parseGeocodingConfig({ provider: "self-hosted", url: "https://nominatim.openstreetmap.org", flavor: "nominatim" }))
      .toEqual({ provider: "none" });
    expect(parseGeocodingConfig({ provider: "self-hosted", url: "http://geo.internal:8080", flavor: "photon" }))
      .toEqual({ provider: "self-hosted", url: "http://geo.internal:8080", flavor: "photon" });
  });
});

describe("none", () => {
  it("geocodes nothing and sends nothing (AC-CMAP-PROVIDER-1)", async () => {
    const fetchImpl = vi.fn();
    const provider = resolveGeocodingProvider({ provider: "none" }, {});
    expect(provider.enabled).toBe(false);
    expect(await provider.geocode([austin], { fetchImpl })).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("census", () => {
  it("sends US addresses as one batch CSV and parses matches", async () => {
    const csv = [
      '"addr-1","1100 Congress Ave, Austin, TX, 78701","Match","Exact","1100 CONGRESS AVE, AUSTIN, TX, 78701","-97.7404,30.2747","1234","L"',
    ].join("\n");
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => csv });
    const provider = resolveGeocodingProvider({ provider: "census" }, {});
    const results = await provider.geocode([austin, paris], { fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://geocoding.geo.census.gov/geocoder/locations/addressbatch");
    const form = init.body as FormData;
    expect(form.get("benchmark")).toBe("Public_AR_Current");
    const upload = await (form.get("addressFile") as Blob).text();
    expect(upload).toBe('"addr-1","1100 Congress Ave","Austin","TX","78701"\n');
    expect(results).toEqual([
      { key: "addr-1", status: "found", latitude: 30.2747, longitude: -97.7404, precision: "exact" },
      { key: "addr-2", status: "not-found" },
    ]);
  });
});

describe("opencage", () => {
  it("needs a key and asks one address per request", async () => {
    expect(resolveGeocodingProvider({ provider: "opencage" }, {}).enabled).toBe(false);
    const fetchImpl = json({ results: [{ geometry: { lat: 48.86, lng: 2.34 }, confidence: 9 }] });
    const provider = resolveGeocodingProvider({ provider: "opencage" }, { opencageKey: "k123" });
    const results = await provider.geocode([paris], { fetchImpl });
    const url = new URL(fetchImpl.mock.calls[0][0] as string);
    expect(url.origin + url.pathname).toBe("https://api.opencagedata.com/geocode/v1/json");
    expect(url.searchParams.get("key")).toBe("k123");
    expect(url.searchParams.get("countrycode")).toBe("fr");
    expect(results).toEqual([{ key: "addr-2", status: "found", latitude: 48.86, longitude: 2.34, precision: "street" }]);
  });
});

describe("self-hosted", () => {
  it("talks to the operator's Nominatim", async () => {
    const fetchImpl = json([{ lat: "30.27", lon: "-97.74" }]);
    const provider = resolveGeocodingProvider({ provider: "self-hosted", url: "http://geo.internal", flavor: "nominatim" }, {});
    const results = await provider.geocode([austin], { fetchImpl });
    expect(new URL(fetchImpl.mock.calls[0][0] as string).origin).toBe("http://geo.internal");
    expect(results[0]).toMatchObject({ status: "found", latitude: 30.27, longitude: -97.74 });
  });

  it("talks to the operator's Photon", async () => {
    const fetchImpl = json({ features: [{ geometry: { coordinates: [2.34, 48.86] } }] });
    const provider = resolveGeocodingProvider({ provider: "self-hosted", url: "http://geo.internal", flavor: "photon" }, {});
    const results = await provider.geocode([paris], { fetchImpl });
    expect(new URL(fetchImpl.mock.calls[0][0] as string).pathname).toBe("/api");
    expect(results[0]).toMatchObject({ status: "found", latitude: 48.86, longitude: 2.34 });
  });
});
