// apps/web/lib/timezone-from-location.ts
//
// Derive an IANA timezone from a captured business location. The platform
// already captures location signals at setup (BusinessContext.stateCode, the
// brand-import country code), so the operating-hours / self-upgrade-window
// timezone should be DERIVED from them rather than asked for or left on the UTC
// placeholder — which is what put the maintenance window at local noon for a US
// Central store (BI-6DA3B06F / BI-0C000AB3).
//
// Country granularity is not enough for large countries: the US spans six zones,
// so a country-only map resolves every US store to Eastern. State-level
// resolution fixes that. Pure data + a pure function, intentionally free of any
// heavy/server-only imports so the unattended cron path
// (resolveOperatingScheduleForSystem) can use it without a bundle-boundary risk.

import { orgAddressTimezoneSignal, type OrgAddress } from "@/lib/shared/org-address";

/**
 * Predominant IANA timezone per US state / territory. States that span more than
 * one zone resolve to their most-populous ("majority") zone as a sensible
 * default the operator can still override in Operating Hours — e.g. Texas →
 * Chicago (El Paso is Mountain), Florida → New_York (the panhandle is Central),
 * Tennessee → Chicago (eastern TN is Eastern). Arizona uses Phoenix (no DST).
 */
export const US_STATE_TO_TIMEZONE: Record<string, string> = {
  AL: "America/Chicago",
  AK: "America/Anchorage",
  AZ: "America/Phoenix",
  AR: "America/Chicago",
  CA: "America/Los_Angeles",
  CO: "America/Denver",
  CT: "America/New_York",
  DE: "America/New_York",
  DC: "America/New_York",
  FL: "America/New_York",
  GA: "America/New_York",
  HI: "Pacific/Honolulu",
  ID: "America/Boise",
  IL: "America/Chicago",
  IN: "America/Indiana/Indianapolis",
  IA: "America/Chicago",
  KS: "America/Chicago",
  KY: "America/New_York",
  LA: "America/Chicago",
  ME: "America/New_York",
  MD: "America/New_York",
  MA: "America/New_York",
  MI: "America/Detroit",
  MN: "America/Chicago",
  MS: "America/Chicago",
  MO: "America/Chicago",
  MT: "America/Denver",
  NE: "America/Chicago",
  NV: "America/Los_Angeles",
  NH: "America/New_York",
  NJ: "America/New_York",
  NM: "America/Denver",
  NY: "America/New_York",
  NC: "America/New_York",
  ND: "America/Chicago",
  OH: "America/New_York",
  OK: "America/Chicago",
  OR: "America/Los_Angeles",
  PA: "America/New_York",
  RI: "America/New_York",
  SC: "America/New_York",
  SD: "America/Chicago",
  TN: "America/Chicago",
  TX: "America/Chicago",
  UT: "America/Denver",
  VT: "America/New_York",
  VA: "America/New_York",
  WA: "America/Los_Angeles",
  WV: "America/New_York",
  WI: "America/Chicago",
  WY: "America/Denver",
  // Territories
  PR: "America/Puerto_Rico",
  VI: "America/Puerto_Rico",
  GU: "Pacific/Guam",
  MP: "Pacific/Guam",
  AS: "Pacific/Pago_Pago",
};

/**
 * Country (ISO 3166-1 alpha-2) → a representative IANA timezone. Canonical home;
 * re-exported from public-web-tools for the brand-import path. Coarse by nature
 * (one zone per country), so US derivation should prefer US_STATE_TO_TIMEZONE.
 */
export const COUNTRY_TO_TIMEZONE: Record<string, string> = {
  GB: "Europe/London",
  IE: "Europe/Dublin",
  DE: "Europe/Berlin",
  FR: "Europe/Paris",
  ES: "Europe/Madrid",
  IT: "Europe/Rome",
  NL: "Europe/Amsterdam",
  BE: "Europe/Brussels",
  AT: "Europe/Vienna",
  PT: "Europe/Lisbon",
  CH: "Europe/Zurich",
  SE: "Europe/Stockholm",
  NO: "Europe/Oslo",
  DK: "Europe/Copenhagen",
  FI: "Europe/Helsinki",
  PL: "Europe/Warsaw",
  CZ: "Europe/Prague",
  AU: "Australia/Sydney",
  NZ: "Pacific/Auckland",
  CA: "America/Toronto",
  US: "America/New_York",
  JP: "Asia/Tokyo",
  CN: "Asia/Shanghai",
  IN: "Asia/Kolkata",
  SG: "Asia/Singapore",
  ZA: "Africa/Johannesburg",
  AE: "Asia/Dubai",
  BR: "America/Sao_Paulo",
  MX: "America/Mexico_City",
  EU: "Europe/Brussels",
};

function normalizeCode(value: string | null | undefined): string | null {
  const v = value?.trim().toUpperCase();
  return v && v.length > 0 ? v : null;
}

/**
 * Resolve an IANA timezone from a captured business location, preferring the
 * most precise signal available:
 *   1. US state code → state-level zone (handles the six US zones correctly).
 *   2. Country code → representative country zone (for non-US installs).
 * Returns null when neither resolves, so callers can fall back (browser-detected
 * zone at the editor, UTC as the last resort) without being handed a wrong guess.
 *
 * Accepts a bare state code (`"IL"`) or a hyphenated subdivision (`"US-IL"`), and
 * tolerates a country code passed in the state slot for convenience.
 */
export function resolveTimezoneFromLocation(args: {
  stateCode?: string | null;
  countryCode?: string | null;
}): string | null {
  const rawState = normalizeCode(args.stateCode);
  // Accept "US-IL" style subdivisions by taking the part after the hyphen.
  const stateCode = rawState?.includes("-") ? rawState.split("-").pop() ?? rawState : rawState;
  if (stateCode && US_STATE_TO_TIMEZONE[stateCode]) {
    return US_STATE_TO_TIMEZONE[stateCode];
  }

  const countryCode = normalizeCode(args.countryCode);
  if (countryCode && COUNTRY_TO_TIMEZONE[countryCode]) {
    return COUNTRY_TO_TIMEZONE[countryCode];
  }
  return null;
}

/**
 * Resolve an IANA timezone from the canonical Organization.address. This is the
 * PRECISE source: a captured US address carries a state code, so it resolves to
 * the right one of the six US zones instead of the country-only Eastern default.
 * Thin wrapper over resolveTimezoneFromLocation using the address's normalized
 * codes; returns null when the address carries no usable location signal.
 */
export function resolveTimezoneFromAddress(addr: OrgAddress): string | null {
  return resolveTimezoneFromLocation(orgAddressTimezoneSignal(addr));
}
