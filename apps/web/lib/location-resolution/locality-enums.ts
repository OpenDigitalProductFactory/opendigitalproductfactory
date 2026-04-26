export const LOCALITY_STATUSES = ["active", "inactive", "needs-review"] as const;
export type LocalityStatus = (typeof LOCALITY_STATUSES)[number];

export const LOCALITY_SOURCES = ["seed", "user", "provider", "import"] as const;
export type LocalitySource = (typeof LOCALITY_SOURCES)[number];

export const LOCALITY_TYPES = [
  "city",
  "town",
  "village",
  "municipality",
  "suburb",
  "district",
  "hamlet",
  "postal-city",
  "unknown",
] as const;
export type LocalityType = (typeof LOCALITY_TYPES)[number];

export const PROVIDER_IDS = ["none", "nominatim", "google-places", "opencage", "census-tiger"] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];

export const DEFAULT_LOCALITY_STATUS: LocalityStatus = "active";
export const DEFAULT_LOCALITY_SOURCE: LocalitySource = "user";
export const DEFAULT_LOCALITY_TYPE: LocalityType = "town";
