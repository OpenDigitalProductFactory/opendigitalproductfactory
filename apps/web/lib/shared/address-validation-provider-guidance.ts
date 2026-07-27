/**
 * Operator-facing provider-choice guidance for site/address validation
 * (BI-SITE-5E6A18 / EP-SITE-7C4D2B).
 *
 * Pure content + status helpers — no Prisma. UI and user-guide share this
 * so Smarty vs Mapbox policy stays single-source.
 */

export type AddressValidationProviderId = "smarty" | "mapbox" | "nominatim";

export type AddressValidationProviderOption = {
  id: AddressValidationProviderId;
  name: string;
  bestFor: string;
  notes: string;
  needsApiKey: boolean;
};

/** One active commercial provider at a time — avoids conflicting lookups. */
export const ADDRESS_VALIDATION_ONE_ACTIVE_POLICY =
  "Enable one commercial address provider at a time. Keep a free fallback only when the commercial path is offline.";

export const ADDRESS_VALIDATION_PROVIDERS: readonly AddressValidationProviderOption[] = [
  {
    id: "smarty",
    name: "Smarty",
    bestFor: "US postal accuracy, CASS-style verification, suite/unit data",
    notes: "Best default when most customer sites are in the United States.",
    needsApiKey: true,
  },
  {
    id: "mapbox",
    name: "Mapbox",
    bestFor: "Global geocoding and map-aligned coordinates",
    notes: "Prefer when sites span multiple countries or you already use Mapbox maps.",
    needsApiKey: true,
  },
  {
    id: "nominatim",
    name: "Nominatim (OSM)",
    bestFor: "Self-hosted / no-key installs",
    notes: "Lower precision for commercial delivery; use as emergency fallback, not primary for field routes.",
    needsApiKey: false,
  },
] as const;

export type AddressValidationSetupStatus = {
  /** True when a geocoding/places/mapbox service row is active. */
  commercialProviderDetected: boolean;
  /** True when site lookup can resolve a validated address ref. */
  siteLookupReady: boolean;
  headline: string;
  nextStep: string;
};

/**
 * Build operator status from live substrate signals (caller supplies booleans).
 */
export function describeAddressValidationSetup(input: {
  commercialProviderDetected: boolean;
  siteLookupReady: boolean;
}): AddressValidationSetupStatus {
  if (input.siteLookupReady) {
    return {
      commercialProviderDetected: input.commercialProviderDetected,
      siteLookupReady: true,
      headline: "Address validation is ready for customer sites.",
      nextStep: "Keep one commercial provider active; re-check after key rotation.",
    };
  }
  if (input.commercialProviderDetected) {
    return {
      commercialProviderDetected: true,
      siteLookupReady: false,
      headline: "A map/geocode service is registered, but site lookup is not wired yet.",
      nextStep: "Finish connecting the active provider to customer site create/edit.",
    };
  }
  return {
    commercialProviderDetected: false,
    siteLookupReady: false,
    headline: "No address validation provider is configured.",
    nextStep: "Choose Smarty (US-first) or Mapbox (global), add one key, leave the other off.",
  };
}

/** Geography hint for progressive disclosure — not a hard router. */
export function suggestProviderForGeography(input: {
  primaryCountry?: string | null;
}): AddressValidationProviderId {
  const country = (input.primaryCountry ?? "").trim().toUpperCase();
  if (country === "US" || country === "USA" || country === "UNITED STATES") {
    return "smarty";
  }
  if (country.length > 0) {
    return "mapbox";
  }
  return "smarty";
}
