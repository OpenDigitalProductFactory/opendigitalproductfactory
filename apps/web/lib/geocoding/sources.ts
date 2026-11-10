// Location source vocabulary (BI-C318C227 §2.1), dependency-free so client
// code such as the organization address picker can classify a stored point
// without pulling in the provider adapters.

export const GEOCODING_PROVIDER_IDS = ["none", "census", "opencage", "self-hosted"] as const;
export type GeocodingProviderId = (typeof GEOCODING_PROVIDER_IDS)[number];

/** Sources a person chose: a hand pin, a picked lookup suggestion, or a phone confirmation at the site. */
export const PERSON_CONFIRMED_SOURCES = ["manual-pin", "nominatim", "device-confirmed"] as const;

/** Sources written by an automatic geocoding provider. */
export const PROVIDER_DERIVED_SOURCES: readonly string[] = GEOCODING_PROVIDER_IDS.filter((id) => id !== "none");

export function isProviderDerivedSource(source: unknown): boolean {
  return typeof source === "string" && PROVIDER_DERIVED_SOURCES.includes(source);
}
