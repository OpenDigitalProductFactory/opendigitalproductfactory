/**
 * Where a stored location came from, and who may replace it (BI-C318C227 §2.1).
 *
 * `Address.validationSource` already records provenance as a free string. This
 * module is the one place that classifies it, so every coordinate write applies
 * the same rule: a provider fills only empty coordinates, a device confirmation
 * may replace a provider's guess, and nothing automatic replaces a location a
 * person confirmed (the BI-560128FB invariant).
 */
import { PERSON_CONFIRMED_SOURCES, PROVIDER_DERIVED_SOURCES } from "./sources";

export { PERSON_CONFIRMED_SOURCES, PROVIDER_DERIVED_SOURCES };

export type LocationProvenance = "person-confirmed" | "provider-derived" | "none";

export function locationProvenance(source: string | null | undefined): LocationProvenance {
  if (!source) return "none";
  if (PROVIDER_DERIVED_SOURCES.includes(source)) return "provider-derived";
  // Unknown sources fail safe: treating them as confirmed means no automatic
  // writer can erase them.
  return "person-confirmed";
}

/** `Address` where-fragment: rows a provider result may write. */
export function replaceableByProviderWhere() {
  return { latitude: null };
}

/** `Address` where-fragment: rows a device confirmation may write. */
export function replaceableByDeviceWhere() {
  return {
    OR: [
      { latitude: null },
      { validationSource: { in: [...PROVIDER_DERIVED_SOURCES] } },
    ],
  };
}
