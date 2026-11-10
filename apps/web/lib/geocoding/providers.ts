// Provider-swappable geocoding (BI-560128FB, field-dispatch ADR-9, design
// docs/superpowers/specs/2026-10-02-customer-map-and-geocoding-design.md §2.4).
//
// The default provider is `none`: it geocodes nothing and sends nothing. An
// administrator may choose a provider whose terms allow bulk use and keeping
// results: the US Census batch geocoder, OpenCage (with a key) or a
// self-hosted Nominatim/Photon. Public Nominatim is refused for bulk use (OSMF
// policy), and Google and Mapbox are absent because their terms forbid keeping
// the coordinates. Pure apart from the injected fetch.

import Papa from "papaparse";

import { GEOCODING_PROVIDER_IDS, type GeocodingProviderId } from "./sources";

export { GEOCODING_PROVIDER_IDS, type GeocodingProviderId };

/** PlatformConfig key holding the administrator's choice. */
export const GEOCODING_PROVIDER_KEY = "geocoding.provider";

export type GeocodingConfig =
  | { provider: "none" }
  | { provider: "census" }
  | { provider: "opencage" }
  | { provider: "self-hosted"; url: string; flavor: "nominatim" | "photon" };

export type GeocodeInput = {
  /** Caller's key, echoed back on the result (the Address id). */
  key: string;
  line1: string;
  city: string;
  region: string;
  postalCode: string;
  /** ISO 3166-1 alpha-2. */
  countryCode: string;
};

export type GeocodeResult =
  | { key: string; status: "found"; latitude: number; longitude: number; precision: "exact" | "street" | "approximate" }
  | { key: string; status: "not-found" };

type FetchLike = (input: string, init?: RequestInit) => Promise<Pick<Response, "ok" | "status" | "json" | "text">>;

export interface GeocodingProvider {
  id: GeocodingProviderId;
  /** False when nothing may be sent: the `none` default, or a provider missing its key. */
  enabled: boolean;
  /** Addresses per request. */
  batchSize: number;
  /** Minimum spacing between requests. */
  minIntervalMs: number;
  geocode(inputs: readonly GeocodeInput[], deps: { fetchImpl: FetchLike }): Promise<GeocodeResult[]>;
}

const PUBLIC_NOMINATIM_HOSTS = new Set(["nominatim.openstreetmap.org", "nominatim.osm.org"]);
const USER_AGENT = "OpenDigitalProductFactory/geocoding (+https://github.com/OpenDigitalProductFactory/opendigitalproductfactory)";

export function parseGeocodingConfig(value: unknown): GeocodingConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { provider: "none" };
  const record = value as Record<string, unknown>;
  if (record.provider === "census" || record.provider === "opencage") return { provider: record.provider };
  if (record.provider === "self-hosted" && typeof record.url === "string") {
    let url: URL;
    try {
      url = new URL(record.url);
    } catch {
      return { provider: "none" };
    }
    if (!/^https?:$/.test(url.protocol) || PUBLIC_NOMINATIM_HOSTS.has(url.hostname)) return { provider: "none" };
    const flavor = record.flavor === "photon" ? "photon" : "nominatim";
    return { provider: "self-hosted", url: url.origin, flavor };
  }
  return { provider: "none" };
}

function oneLine(input: GeocodeInput): string {
  return [input.line1, input.city, input.region, input.postalCode].filter(Boolean).join(", ");
}

const none: GeocodingProvider = {
  id: "none",
  enabled: false,
  batchSize: 0,
  minIntervalMs: 0,
  async geocode() {
    return [];
  },
};

// US Census Geocoder batch: up to 10,000 US addresses per CSV upload.
const census: GeocodingProvider = {
  id: "census",
  enabled: true,
  batchSize: 1000,
  minIntervalMs: 1000,
  async geocode(inputs, { fetchImpl }) {
    const us = inputs.filter((input) => input.countryCode === "US");
    const results = new Map<string, GeocodeResult>();
    if (us.length > 0) {
      const csv = `${Papa.unparse(us.map((input) => [input.key, input.line1, input.city, input.region, input.postalCode]), { quotes: true, newline: "\n" })}\n`;
      const form = new FormData();
      form.set("benchmark", "Public_AR_Current");
      form.set("addressFile", new Blob([csv], { type: "text/csv" }), "addresses.csv");
      const response = await fetchImpl("https://geocoding.geo.census.gov/geocoder/locations/addressbatch", {
        method: "POST",
        body: form,
        headers: { "User-Agent": USER_AGENT },
      });
      if (!response.ok) throw new Error(`Census geocoder answered ${response.status}.`);
      const rows = Papa.parse<string[]>(await response.text(), { skipEmptyLines: true }).data;
      for (const row of rows) {
        const [key, , match, kind, , lonLat] = row;
        if (!key || match !== "Match" || !lonLat) continue;
        const [lon, lat] = lonLat.split(",").map(Number);
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
        results.set(key, { key, status: "found", latitude: lat!, longitude: lon!, precision: kind === "Exact" ? "exact" : "approximate" });
      }
    }
    return inputs.map((input) => results.get(input.key) ?? { key: input.key, status: "not-found" });
  },
};

function opencage(apiKey: string | undefined): GeocodingProvider {
  return {
    id: "opencage",
    enabled: Boolean(apiKey),
    batchSize: 1,
    minIntervalMs: 1000,
    async geocode(inputs, { fetchImpl }) {
      if (!apiKey) return [];
      const results: GeocodeResult[] = [];
      for (const input of inputs) {
        const url = new URL("https://api.opencagedata.com/geocode/v1/json");
        url.searchParams.set("q", oneLine(input));
        url.searchParams.set("countrycode", input.countryCode.toLowerCase());
        url.searchParams.set("limit", "1");
        url.searchParams.set("no_annotations", "1");
        url.searchParams.set("key", apiKey);
        const response = await fetchImpl(url.toString(), { headers: { "User-Agent": USER_AGENT } });
        if (!response.ok) throw new Error(`OpenCage answered ${response.status}.`);
        const body = (await response.json()) as { results?: Array<{ geometry?: { lat?: number; lng?: number }; confidence?: number }> };
        const hit = body.results?.[0]?.geometry;
        results.push(
          typeof hit?.lat === "number" && typeof hit.lng === "number"
            ? {
                key: input.key,
                status: "found",
                latitude: hit.lat,
                longitude: hit.lng,
                precision: (body.results?.[0]?.confidence ?? 0) >= 9 ? "street" : "approximate",
              }
            : { key: input.key, status: "not-found" },
        );
      }
      return results;
    },
  };
}

function selfHosted(config: Extract<GeocodingConfig, { provider: "self-hosted" }>): GeocodingProvider {
  return {
    id: "self-hosted",
    enabled: true,
    batchSize: 1,
    minIntervalMs: 200,
    async geocode(inputs, { fetchImpl }) {
      const results: GeocodeResult[] = [];
      for (const input of inputs) {
        const url = new URL(config.flavor === "photon" ? "/api" : "/search", config.url);
        url.searchParams.set("q", `${oneLine(input)}, ${input.countryCode}`);
        url.searchParams.set("limit", "1");
        if (config.flavor === "nominatim") url.searchParams.set("format", "jsonv2");
        const response = await fetchImpl(url.toString(), { headers: { "User-Agent": USER_AGENT } });
        if (!response.ok) throw new Error(`The geocoding server answered ${response.status}.`);
        const body = (await response.json()) as unknown;
        let lat: number | undefined;
        let lon: number | undefined;
        if (config.flavor === "photon") {
          const coordinates = (body as { features?: Array<{ geometry?: { coordinates?: number[] } }> }).features?.[0]?.geometry?.coordinates;
          [lon, lat] = coordinates ?? [];
        } else {
          const hit = (body as Array<{ lat?: string; lon?: string }>)[0];
          lat = hit ? Number(hit.lat) : undefined;
          lon = hit ? Number(hit.lon) : undefined;
        }
        results.push(
          Number.isFinite(lat) && Number.isFinite(lon)
            ? { key: input.key, status: "found", latitude: lat!, longitude: lon!, precision: "street" }
            : { key: input.key, status: "not-found" },
        );
      }
      return results;
    },
  };
}

export function resolveGeocodingProvider(config: GeocodingConfig, secrets: { opencageKey?: string }): GeocodingProvider {
  switch (config.provider) {
    case "census":
      return census;
    case "opencage":
      return opencage(secrets.opencageKey);
    case "self-hosted":
      return selfHosted(config);
    default:
      return none;
  }
}
