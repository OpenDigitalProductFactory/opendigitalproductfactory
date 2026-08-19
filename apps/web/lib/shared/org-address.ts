// apps/web/lib/shared/org-address.ts
//
// Canonical shape + helpers for Organization.address (a Json? column — the
// single source of truth for the install's business address per AGENTS.md S11).
//
// Several readers already consume this blob with slightly different key
// expectations: org-identity.formatAddress (invoices/emails), marketing
// summarizeAddress, storefront/storefront-data (StorefrontAddress { street, city,
// postcode, country }), and the directory `nearby` route (city/region + lat/lng).
// This module is the one place that knows the canonical key set, parses the
// historical variants tolerantly, and serializes a form back in a shape every
// reader understands — without forcing edits across all of them.
//
// Pure data + pure functions only (no Prisma / server-only imports) so the
// dependency-light timezone derivation and the unattended self-upgrade cron path
// can import it, exactly like timezone-from-location.ts. NOTE: do not import
// timezone-from-location here — that module imports this one (resolveTimezone-
// FromAddress), so the dependency must stay one-directional.

/**
 * Canonical Organization.address shape. Display fields (`region`, `country`) are
 * human-readable so existing readers render nicely; the normalized `stateCode` /
 * `countryCode` drive precise derivation (timezone today; tax/region later).
 */
export type OrgAddress = {
  line1?: string;
  line2?: string;
  city?: string;
  /** State / province DISPLAY name, e.g. "Illinois". Readers (nearby, invoices) use this. */
  region?: string;
  postalCode?: string;
  /** Country DISPLAY name, e.g. "United States". */
  country?: string;
  /** Normalized US 2-letter subdivision code, e.g. "IL" — drives state-accurate timezone. */
  stateCode?: string;
  /** ISO 3166-1 alpha-2 country code, e.g. "US" — drives the country-level timezone fallback. */
  countryCode?: string;
};

/**
 * US states + DC + territories, label list for the address picker. Codes MUST
 * stay in sync with US_STATE_TO_TIMEZONE in timezone-from-location.ts; the vitest
 * guard in org-address.test.ts asserts coverage both ways so a new state can't be
 * added in one place and forgotten in the other.
 */
export const US_STATES: ReadonlyArray<{ code: string; name: string }> = [
  { code: "AL", name: "Alabama" },
  { code: "AK", name: "Alaska" },
  { code: "AZ", name: "Arizona" },
  { code: "AR", name: "Arkansas" },
  { code: "CA", name: "California" },
  { code: "CO", name: "Colorado" },
  { code: "CT", name: "Connecticut" },
  { code: "DE", name: "Delaware" },
  { code: "DC", name: "District of Columbia" },
  { code: "FL", name: "Florida" },
  { code: "GA", name: "Georgia" },
  { code: "HI", name: "Hawaii" },
  { code: "ID", name: "Idaho" },
  { code: "IL", name: "Illinois" },
  { code: "IN", name: "Indiana" },
  { code: "IA", name: "Iowa" },
  { code: "KS", name: "Kansas" },
  { code: "KY", name: "Kentucky" },
  { code: "LA", name: "Louisiana" },
  { code: "ME", name: "Maine" },
  { code: "MD", name: "Maryland" },
  { code: "MA", name: "Massachusetts" },
  { code: "MI", name: "Michigan" },
  { code: "MN", name: "Minnesota" },
  { code: "MS", name: "Mississippi" },
  { code: "MO", name: "Missouri" },
  { code: "MT", name: "Montana" },
  { code: "NE", name: "Nebraska" },
  { code: "NV", name: "Nevada" },
  { code: "NH", name: "New Hampshire" },
  { code: "NJ", name: "New Jersey" },
  { code: "NM", name: "New Mexico" },
  { code: "NY", name: "New York" },
  { code: "NC", name: "North Carolina" },
  { code: "ND", name: "North Dakota" },
  { code: "OH", name: "Ohio" },
  { code: "OK", name: "Oklahoma" },
  { code: "OR", name: "Oregon" },
  { code: "PA", name: "Pennsylvania" },
  { code: "RI", name: "Rhode Island" },
  { code: "SC", name: "South Carolina" },
  { code: "SD", name: "South Dakota" },
  { code: "TN", name: "Tennessee" },
  { code: "TX", name: "Texas" },
  { code: "UT", name: "Utah" },
  { code: "VT", name: "Vermont" },
  { code: "VA", name: "Virginia" },
  { code: "WA", name: "Washington" },
  { code: "WV", name: "West Virginia" },
  { code: "WI", name: "Wisconsin" },
  { code: "WY", name: "Wyoming" },
  // Territories
  { code: "PR", name: "Puerto Rico" },
  { code: "VI", name: "U.S. Virgin Islands" },
  { code: "GU", name: "Guam" },
  { code: "MP", name: "Northern Mariana Islands" },
  { code: "AS", name: "American Samoa" },
];

/**
 * Countries offered in the address picker — the set the timezone derivation can
 * resolve (COUNTRY_TO_TIMEZONE), common ones first. The form also offers an
 * "Other / not listed" escape hatch that stores a free-text country with no
 * code (no derived timezone; the Operating Hours picker covers it). Intentionally
 * NOT the full 250-row ISO list — short, honest, and covers what we can derive.
 */
export const COUNTRY_OPTIONS: ReadonlyArray<{ code: string; name: string }> = [
  { code: "US", name: "United States" },
  { code: "GB", name: "United Kingdom" },
  { code: "CA", name: "Canada" },
  { code: "AU", name: "Australia" },
  { code: "IE", name: "Ireland" },
  { code: "NZ", name: "New Zealand" },
  { code: "AT", name: "Austria" },
  { code: "BE", name: "Belgium" },
  { code: "BR", name: "Brazil" },
  { code: "CN", name: "China" },
  { code: "CZ", name: "Czechia" },
  { code: "DK", name: "Denmark" },
  { code: "FI", name: "Finland" },
  { code: "FR", name: "France" },
  { code: "DE", name: "Germany" },
  { code: "IN", name: "India" },
  { code: "IT", name: "Italy" },
  { code: "JP", name: "Japan" },
  { code: "MX", name: "Mexico" },
  { code: "NL", name: "Netherlands" },
  { code: "NO", name: "Norway" },
  { code: "PL", name: "Poland" },
  { code: "PT", name: "Portugal" },
  { code: "SG", name: "Singapore" },
  { code: "ZA", name: "South Africa" },
  { code: "ES", name: "Spain" },
  { code: "SE", name: "Sweden" },
  { code: "CH", name: "Switzerland" },
  { code: "AE", name: "United Arab Emirates" },
];

const US_STATE_NAME_BY_CODE = new Map(US_STATES.map((s) => [s.code, s.name]));
const COUNTRY_NAME_BY_CODE = new Map(COUNTRY_OPTIONS.map((c) => [c.code, c.name]));

/** Display name for a US state code, or null when unknown. */
export function usStateName(code: string | null | undefined): string | null {
  const c = code?.trim().toUpperCase();
  return (c && US_STATE_NAME_BY_CODE.get(c)) || null;
}

/** Display name for an ISO alpha-2 country code, or null when unknown. */
export function countryName(code: string | null | undefined): string | null {
  const c = code?.trim().toUpperCase();
  return (c && COUNTRY_NAME_BY_CODE.get(c)) || null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const t = value.trim();
  return t.length > 0 ? t : undefined;
}

function code(value: unknown): string | undefined {
  const s = str(value);
  return s ? s.toUpperCase() : undefined;
}

/**
 * Parse the stored Organization.address JSON into the canonical shape, tolerant
 * of the historical key variants: line1|street, postalCode|postcode|zip,
 * region|state. Unknown keys (latitude/longitude, legacy `location`/`timezone`)
 * are ignored here but preserved by serializeOrgAddress.
 */
export function parseOrgAddress(json: unknown): OrgAddress {
  if (!isRecord(json)) return {};
  const a = json;
  const out: OrgAddress = {
    line1: str(a.line1) ?? str(a.street),
    line2: str(a.line2),
    city: str(a.city),
    region: str(a.region) ?? str(a.state),
    postalCode: str(a.postalCode) ?? str(a.postcode) ?? str(a.zip),
    country: str(a.country),
    stateCode: code(a.stateCode),
    countryCode: code(a.countryCode),
  };
  // Drop undefined keys for a clean object.
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v !== undefined)) as OrgAddress;
}

/**
 * Normalize a captured address: trim, uppercase codes, and backfill the display
 * `region` / `country` from the codes when the picker only sent a code. Returns a
 * clean OrgAddress with empty fields omitted.
 */
export function normalizeOrgAddress(input: OrgAddress): OrgAddress {
  const stateCode = code(input.stateCode);
  const countryCode = code(input.countryCode);
  const out: OrgAddress = {
    line1: str(input.line1),
    line2: str(input.line2),
    city: str(input.city),
    region: str(input.region) ?? usStateName(stateCode) ?? undefined,
    postalCode: str(input.postalCode),
    country: str(input.country) ?? countryName(countryCode) ?? undefined,
    stateCode,
    countryCode,
  };
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v !== undefined)) as OrgAddress;
}

// Canonical write keys + the back-compat mirrors (street=line1, postcode=postalCode)
// that the StorefrontAddress / storefront-data reader expects. Listing them here
// lets serialize clear a field the operator emptied (delete key + mirror) while
// leaving unknown keys — latitude/longitude, legacy location/timezone — untouched.
const CANONICAL_TO_MIRROR: Record<string, string | null> = {
  line1: "street",
  line2: null,
  city: null,
  region: null,
  postalCode: "postcode",
  country: null,
  stateCode: null,
  countryCode: null,
};

/**
 * Serialize a captured address back to the Organization.address JSON, merged
 * NON-DESTRUCTIVELY onto the existing value so geocoding (latitude/longitude) and
 * any other unknown keys survive. Writes canonical keys plus the street/postcode
 * mirrors so every existing reader keeps working with zero edits. The superseded
 * legacy free-text `location` key is dropped (the structured fields replace it).
 */
export function serializeOrgAddress(
  input: OrgAddress,
  existing?: unknown,
): Record<string, unknown> {
  const result: Record<string, unknown> = isRecord(existing) ? { ...existing } : {};
  const addr = normalizeOrgAddress(input);

  for (const [key, mirror] of Object.entries(CANONICAL_TO_MIRROR)) {
    const value = (addr as Record<string, string | undefined>)[key];
    if (value !== undefined) {
      result[key] = value;
      if (mirror) result[mirror] = value;
    } else {
      delete result[key];
      if (mirror) delete result[mirror];
    }
  }

  // The structured address supersedes the historical free-text "location" blob
  // (setup-entities.createOrganization) so the display readers don't show both.
  delete result.location;

  return result;
}

// Display key order for formatOrgAddressLines — mirrors org-identity's historical
// ADDRESS_KEYS so invoice/email output is unchanged, with the legacy `location`
// appended last as a graceful fallback for installs that only ever stored it.
const DISPLAY_KEYS = [
  "line1",
  "line2",
  "street",
  "city",
  "region",
  "state",
  "county",
  "postalCode",
  "postcode",
  "zip",
  "country",
  "location",
] as const;

/**
 * Format the stored address JSON into de-duplicated display lines. Single source
 * of truth for address display (org-identity delegates here).
 */
export function formatOrgAddressLines(json: unknown): string[] {
  if (!isRecord(json)) return [];
  const lines: string[] = [];
  const seen = new Set<string>();
  for (const key of DISPLAY_KEYS) {
    const v = json[key];
    if (typeof v === "string") {
      const t = v.trim();
      if (t && !seen.has(t)) {
        seen.add(t);
        lines.push(t);
      }
    }
  }
  return lines;
}

const MAX_FIELD_LEN = 200;

function clampField(value: unknown): string | undefined {
  const s = str(value);
  return s ? s.slice(0, MAX_FIELD_LEN) : undefined;
}

/**
 * Coerce an untrusted client payload into a clean OrgAddress at the API trust
 * boundary: string-coerce + length-cap the free-text fields, and only accept a
 * stateCode / countryCode that is actually in the known sets (an unknown code is
 * dropped — the display text is kept, derivation simply falls back). Returns the
 * normalized address (display names backfilled from the codes).
 */
export function sanitizeOrgAddressInput(raw: unknown): OrgAddress {
  if (!isRecord(raw)) return {};
  const stateCode = code(raw.stateCode);
  const countryCode = code(raw.countryCode);
  return normalizeOrgAddress({
    line1: clampField(raw.line1),
    line2: clampField(raw.line2),
    city: clampField(raw.city),
    region: clampField(raw.region),
    postalCode: clampField(raw.postalCode),
    country: clampField(raw.country),
    stateCode: stateCode && US_STATE_NAME_BY_CODE.has(stateCode) ? stateCode : undefined,
    countryCode: countryCode && COUNTRY_NAME_BY_CODE.has(countryCode) ? countryCode : undefined,
  });
}

/**
 * Extract the normalized location signal an address carries for timezone
 * derivation. Returns nulls when codes are absent so callers fall back safely.
 */
export function orgAddressTimezoneSignal(
  addr: OrgAddress,
): { stateCode: string | null; countryCode: string | null } {
  return {
    stateCode: addr.stateCode ?? null,
    countryCode: addr.countryCode ?? null,
  };
}
