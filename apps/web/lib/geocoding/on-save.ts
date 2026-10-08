// Geocode one saved location (BI-C318C227 §2.1). A save emits a job; the job
// calls these with the administrator's provider. Each writes only where the
// provenance rule allows, so a pin, a picked suggestion or a phone
// confirmation made meanwhile is never overwritten.

import { extractOrgLatLng } from "@/lib/api/nearby-geo";
import { isRecord } from "@/lib/shared/coerce";
import { parseOrgAddress } from "@/lib/shared/org-address";

import type { GeocodeInput, GeocodingProvider } from "./providers";
import { replaceableByProviderWhere } from "./provenance";

type FetchImpl = Parameters<GeocodingProvider["geocode"]>[1]["fetchImpl"];

export type GeocodeOnSaveOutcome = "placed" | "not-found" | "skipped";

type AddressRow = {
  id: string;
  addressLine1: string;
  postalCode: string;
  latitude: unknown;
  city: { name: string; region: { name: string; code: string | null; country: { iso2: string } } };
};

export interface OnSaveDb {
  address: {
    findUnique(args: unknown): Promise<AddressRow | null>;
    updateMany(args: unknown): Promise<{ count: number }>;
  };
  organization: {
    findUnique(args: unknown): Promise<{ id: string; address: unknown } | null>;
    updateMany(args: unknown): Promise<{ count: number }>;
  };
}

/** Geocode one `Address` row if it still has no coordinates. */
export async function geocodeSavedAddress(
  db: OnSaveDb,
  provider: GeocodingProvider,
  addressId: string,
  deps: { fetchImpl: FetchImpl; now?: Date },
): Promise<GeocodeOnSaveOutcome> {
  if (!provider.enabled) return "skipped";
  const row = await db.address.findUnique({
    where: { id: addressId },
    select: {
      id: true,
      addressLine1: true,
      postalCode: true,
      latitude: true,
      city: { select: { name: true, region: { select: { name: true, code: true, country: { select: { iso2: true } } } } } },
    },
  });
  if (!row || row.latitude !== null || !row.addressLine1.trim()) return "skipped";
  const input: GeocodeInput = {
    key: row.id,
    line1: row.addressLine1,
    city: row.city.name,
    region: row.city.region.code ?? row.city.region.name,
    postalCode: row.postalCode,
    countryCode: row.city.region.country.iso2,
  };
  const [result] = await provider.geocode([input], { fetchImpl: deps.fetchImpl });
  if (result?.status !== "found") return "not-found";
  const written = await db.address.updateMany({
    where: { id: row.id, ...replaceableByProviderWhere() },
    data: {
      latitude: result.latitude,
      longitude: result.longitude,
      validatedAt: deps.now ?? new Date(),
      validationSource: provider.id,
    },
  });
  return written.count > 0 ? "placed" : "skipped";
}

/**
 * Geocode the organization's own address into `Organization.address`, the
 * keys the walk-up front door's nearby discovery already reads
 * (`extractOrgLatLng`).
 */
export async function geocodeOrganizationAddress(
  db: OnSaveDb,
  provider: GeocodingProvider,
  organizationId: string,
  deps: { fetchImpl: FetchImpl; now?: Date },
): Promise<GeocodeOnSaveOutcome> {
  if (!provider.enabled) return "skipped";
  const org = await db.organization.findUnique({
    where: { id: organizationId },
    select: { id: true, address: true },
  });
  if (!org || !isRecord(org.address)) return "skipped";
  if (extractOrgLatLng(org.address)) return "skipped";
  const address = parseOrgAddress(org.address);
  if (!address.line1?.trim() || !address.countryCode) return "skipped";
  const input: GeocodeInput = {
    key: org.id,
    line1: address.line1,
    city: address.city ?? "",
    region: address.stateCode ?? address.region ?? "",
    postalCode: address.postalCode ?? "",
    countryCode: address.countryCode,
  };
  const [result] = await provider.geocode([input], { fetchImpl: deps.fetchImpl });
  if (result?.status !== "found") return "not-found";
  // Compare-and-set on the JSON we read: if the address was edited or pinned
  // while the lookup ran, this write matches nothing and the newer value wins.
  const written = await db.organization.updateMany({
    where: { id: org.id, address: { equals: org.address } },
    data: {
      address: {
        ...org.address,
        latitude: result.latitude,
        longitude: result.longitude,
        validationSource: provider.id,
        validatedAt: (deps.now ?? new Date()).toISOString(),
      },
    },
  });
  return written.count > 0 ? "placed" : "skipped";
}
