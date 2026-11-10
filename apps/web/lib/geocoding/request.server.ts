import "server-only";

// Ask for one saved location to be geocoded (BI-C318C227 §2.1). Called after a
// save commits. Sends nothing under the default provider `none`, and never
// throws: a save must not fail because geocoding could not be queued.

import { prisma } from "@dpf/db";

import { jobs } from "@/lib/jobs";

import { GEOCODING_PROVIDER_KEY, parseGeocodingConfig } from "./providers";

async function providerChosen(): Promise<boolean> {
  const row = await prisma.platformConfig.findUnique({
    where: { key: GEOCODING_PROVIDER_KEY },
    select: { value: true },
  });
  return parseGeocodingConfig(row?.value).provider !== "none";
}

async function send(event: { name: "geocode/address.requested"; data: { addressId: string } } | { name: "geocode/organization.requested"; data: { organizationId: string } }) {
  try {
    if (!(await providerChosen())) return false;
    await jobs.send(event);
    return true;
  } catch (err) {
    console.warn("[geocoding] could not queue geocode-on-save", event.name, err);
    return false;
  }
}

export function requestAddressGeocode(addressId: string): Promise<boolean> {
  return send({ name: "geocode/address.requested", data: { addressId } });
}

export function requestOrganizationGeocode(organizationId: string): Promise<boolean> {
  return send({ name: "geocode/organization.requested", data: { organizationId } });
}

/** Queue a geocode for an `Address` only when it still has no coordinates. */
export async function requestAddressGeocodeIfMissing(addressId: string | null | undefined): Promise<boolean> {
  if (!addressId) return false;
  try {
    const row = await prisma.address.findUnique({ where: { id: addressId }, select: { latitude: true } });
    if (!row || row.latitude !== null) return false;
  } catch (err) {
    console.warn("[geocoding] could not read address before queueing", err);
    return false;
  }
  return requestAddressGeocode(addressId);
}
