"use server";

import { prisma } from "@dpf/db";
import { normalizeLocalityName } from "@dpf/db/location-normalize";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import {
  SUPERSEDED_STATUS,
  planRegionMerge,
  validateCityMergePair,
  validateRegionMergePair,
  type MergeValidationError,
} from "@/lib/mdm/reference-data-merge";
import { can } from "@/lib/permissions";
import type { WorkforceActionResult } from "./workforce";

// ─── Types ───────────────────────────────────────────────────────────────────

export type WorkLocationAddressInput = {
  label: string;
  addressLine1: string;
  addressLine2?: string | null;
  cityId: string;
  postalCode: string;
};

const VALID_LABELS = ["home", "work", "billing", "shipping", "headquarters", "site"];

// ─── Auth helper ─────────────────────────────────────────────────────────────

async function requireAdminCapability(): Promise<WorkforceActionResult | null> {
  const session = await auth();
  const user = session?.user;
  if (!user?.id) return { ok: false, message: "Unauthorized" };
  if (!can({ platformRole: user.platformRole, isSuperuser: user.isSuperuser }, "view_admin")) {
    return { ok: false, message: "Unauthorized" };
  }
  return null;
}

function revalidateAdminPaths(): void {
  revalidatePath("/admin/reference-data");
  revalidatePath("/employee");
}

// ─── Bounded reference search ────────────────────────────────────────────────

const ADMIN_REFERENCE_SEARCH_LIMIT = 20;

function boundedSearchQuery(query: string): string {
  return query.trim().slice(0, 100);
}

export async function searchAdminRegions(query: string) {
  const denied = await requireAdminCapability();
  const normalized = boundedSearchQuery(query);
  if (denied || !normalized) return [];

  return prisma.region.findMany({
    where: {
      status: "active",
      OR: [
        { name: { contains: normalized, mode: "insensitive" } },
        { code: { contains: normalized, mode: "insensitive" } },
        {
          country: {
            name: { contains: normalized, mode: "insensitive" },
          },
        },
      ],
    },
    select: {
      id: true,
      name: true,
      code: true,
      country: { select: { id: true, name: true, iso2: true } },
    },
    orderBy: [{ name: "asc" }, { country: { name: "asc" } }],
    take: ADMIN_REFERENCE_SEARCH_LIMIT,
  });
}

export async function searchRegionMergeCandidates(
  countryId: string,
  loserId: string,
  query: string,
) {
  const denied = await requireAdminCapability();
  const normalized = boundedSearchQuery(query);
  if (denied || !countryId || !loserId || !normalized) return [];

  return prisma.region.findMany({
    where: {
      countryId,
      id: { not: loserId },
      status: "active",
      OR: [
        { name: { contains: normalized, mode: "insensitive" } },
        { code: { contains: normalized, mode: "insensitive" } },
      ],
    },
    select: { id: true, name: true, code: true },
    orderBy: { name: "asc" },
    take: ADMIN_REFERENCE_SEARCH_LIMIT,
  });
}

export async function searchCityMergeCandidates(
  regionId: string,
  loserId: string,
  query: string,
) {
  const denied = await requireAdminCapability();
  const normalized = boundedSearchQuery(query);
  if (denied || !regionId || !loserId || !normalized) return [];

  return prisma.city.findMany({
    where: {
      regionId,
      id: { not: loserId },
      status: "active",
      name: { contains: normalized, mode: "insensitive" },
    },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
    take: ADMIN_REFERENCE_SEARCH_LIMIT,
  });
}

// ─── Toggle Country Status ───────────────────────────────────────────────────

export async function toggleCountryStatus(id: string): Promise<WorkforceActionResult> {
  const denied = await requireAdminCapability();
  if (denied) return denied;

  const country = await prisma.country.findUnique({ where: { id }, select: { id: true, name: true, status: true } });
  if (!country) return { ok: false, message: "Country not found." };

  const newStatus = country.status === "active" ? "inactive" : "active";
  await prisma.country.update({ where: { id }, data: { status: newStatus } });

  revalidateAdminPaths();
  return { ok: true, message: `Country "${country.name}" is now ${newStatus}.` };
}

// ─── Update Region ───────────────────────────────────────────────────────────

export async function updateRegion(
  id: string,
  data: { name?: string; code?: string },
): Promise<WorkforceActionResult> {
  const denied = await requireAdminCapability();
  if (denied) return denied;

  const updateData: Record<string, string> = {};

  if (data.name !== undefined) {
    const trimmed = data.name.trim();
    if (!trimmed) return { ok: false, message: "Region name cannot be empty." };
    updateData.name = trimmed;
  }

  if (data.code !== undefined) {
    updateData.code = data.code.trim();
  }

  const region = await prisma.region.findUnique({ where: { id }, select: { id: true } });
  if (!region) return { ok: false, message: "Region not found." };

  await prisma.region.update({ where: { id }, data: updateData });

  revalidateAdminPaths();
  return { ok: true, message: "Region updated." };
}

// ─── Toggle Region Status ────────────────────────────────────────────────────

export async function toggleRegionStatus(id: string): Promise<WorkforceActionResult> {
  const denied = await requireAdminCapability();
  if (denied) return denied;

  const region = await prisma.region.findUnique({ where: { id }, select: { id: true, name: true, status: true } });
  if (!region) return { ok: false, message: "Region not found." };

  const newStatus = region.status === "active" ? "inactive" : "active";
  await prisma.region.update({ where: { id }, data: { status: newStatus } });

  revalidateAdminPaths();
  return { ok: true, message: `Region "${region.name}" is now ${newStatus}.` };
}

// ─── Update City ─────────────────────────────────────────────────────────────

export async function updateCity(
  id: string,
  data: { name?: string },
): Promise<WorkforceActionResult> {
  const denied = await requireAdminCapability();
  if (denied) return denied;

  if (data.name !== undefined) {
    const trimmed = data.name.trim();
    if (!trimmed) return { ok: false, message: "City name cannot be empty." };

    const city = await prisma.city.findUnique({ where: { id }, select: { id: true } });
    if (!city) return { ok: false, message: "City not found." };

    await prisma.city.update({
      where: { id },
      data: { name: trimmed, nameNormalized: normalizeLocalityName(trimmed) },
    });
  }

  revalidateAdminPaths();
  return { ok: true, message: "City updated." };
}

// ─── Toggle City Status ──────────────────────────────────────────────────────

export async function toggleCityStatus(id: string): Promise<WorkforceActionResult> {
  const denied = await requireAdminCapability();
  if (denied) return denied;

  const city = await prisma.city.findUnique({ where: { id }, select: { id: true, name: true, status: true } });
  if (!city) return { ok: false, message: "City not found." };

  const newStatus = city.status === "active" ? "inactive" : "active";
  await prisma.city.update({ where: { id }, data: { status: newStatus } });

  revalidateAdminPaths();
  return { ok: true, message: `City "${city.name}" is now ${newStatus}.` };
}

// ─── Link Work Location Address ──────────────────────────────────────────────

export async function linkWorkLocationAddress(
  locationId: string,
  addressData: WorkLocationAddressInput,
): Promise<WorkforceActionResult> {
  const denied = await requireAdminCapability();
  if (denied) return denied;

  // Validate required fields
  const label = addressData.label.trim();
  const addressLine1 = addressData.addressLine1.trim();
  const cityId = addressData.cityId.trim();
  const postalCode = addressData.postalCode.trim();

  if (!label) return { ok: false, message: "Label is required." };
  if (!VALID_LABELS.includes(label)) {
    return { ok: false, message: `Invalid label. Must be one of: ${VALID_LABELS.join(", ")}.` };
  }
  if (!addressLine1) return { ok: false, message: "Address line 1 is required." };
  if (!cityId) return { ok: false, message: "City is required." };
  if (!postalCode) return { ok: false, message: "Postal code is required." };

  const location = await prisma.workLocation.findUnique({ where: { id: locationId }, select: { id: true } });
  if (!location) return { ok: false, message: "Work location not found." };

  await prisma.$transaction(async (tx) => {
    const address = await tx.address.create({
      data: {
        label,
        addressLine1,
        addressLine2: addressData.addressLine2?.trim() || null,
        cityId,
        postalCode,
        status: "active",
      },
    });

    await tx.workLocation.update({
      where: { id: locationId },
      data: { addressId: address.id },
    });
  });

  revalidateAdminPaths();
  return { ok: true, message: "Address linked to work location." };
}

// ─── Unlink Work Location Address ────────────────────────────────────────────

export async function unlinkWorkLocationAddress(
  locationId: string,
): Promise<WorkforceActionResult> {
  const denied = await requireAdminCapability();
  if (denied) return denied;

  const location = await prisma.workLocation.findUnique({
    where: { id: locationId },
    select: { id: true, addressId: true },
  });
  if (!location) return { ok: false, message: "Work location not found." };
  if (!location.addressId) return { ok: false, message: "Work location has no linked address." };

  const addressId = location.addressId;

  await prisma.$transaction(async (tx) => {
    await tx.workLocation.update({
      where: { id: locationId },
      data: { addressId: null },
    });

    await tx.address.update({
      where: { id: addressId },
      data: { status: "inactive" },
    });
  });

  revalidateAdminPaths();
  return { ok: true, message: "Address unlinked and soft-deleted." };
}

// ─── Reference-data merge (MDM-5, spec §7 step 5) ────────────────────────────

export type MergePreview = {
  ok: boolean;
  message: string;
  impact?: {
    citiesRepointed: number;
    citiesMerged: number;
    addressesAffected: number;
  };
};

function mergeErrorMessage(error: MergeValidationError): string {
  switch (error) {
    case "same-record":
      return "Cannot merge a record into itself.";
    case "different-country":
      return "Regions in different countries cannot be merged.";
    case "different-region":
      return "Cities in different regions cannot be merged.";
  }
}

// ─── Preview / Merge City ────────────────────────────────────────────────────

export async function previewCityMerge(
  loserId: string,
  survivorId: string,
): Promise<MergePreview> {
  const denied = await requireAdminCapability();
  if (denied) return denied;

  const [loser, survivor] = await Promise.all([
    prisma.city.findUnique({ where: { id: loserId }, select: { id: true, regionId: true, name: true } }),
    prisma.city.findUnique({ where: { id: survivorId }, select: { id: true, regionId: true, name: true } }),
  ]);
  if (!loser || !survivor) return { ok: false, message: "City not found." };

  const invalid = validateCityMergePair(loser, survivor);
  if (invalid) return { ok: false, message: mergeErrorMessage(invalid) };

  const addressesAffected = await prisma.address.count({ where: { cityId: loserId } });
  return {
    ok: true,
    message: `Merging "${loser.name}" → "${survivor.name}" will repoint ${addressesAffected} address(es) and tombstone "${loser.name}".`,
    impact: { citiesRepointed: 0, citiesMerged: 1, addressesAffected },
  };
}

export async function mergeCity(
  loserId: string,
  survivorId: string,
): Promise<WorkforceActionResult> {
  const denied = await requireAdminCapability();
  if (denied) return denied;

  const [loser, survivor] = await Promise.all([
    prisma.city.findUnique({ where: { id: loserId }, select: { id: true, regionId: true, name: true } }),
    prisma.city.findUnique({ where: { id: survivorId }, select: { id: true, regionId: true } }),
  ]);
  if (!loser || !survivor) return { ok: false, message: "City not found." };

  const invalid = validateCityMergePair(loser, survivor);
  if (invalid) return { ok: false, message: mergeErrorMessage(invalid) };

  await prisma.$transaction(async (tx) => {
    await tx.address.updateMany({ where: { cityId: loserId }, data: { cityId: survivorId } });
    await tx.city.update({
      where: { id: loserId },
      data: { status: SUPERSEDED_STATUS, mergedIntoId: survivorId },
    });
  });

  revalidateAdminPaths();
  return { ok: true, message: `City "${loser.name}" merged and superseded.` };
}

// ─── Preview / Merge Region ──────────────────────────────────────────────────

export async function previewRegionMerge(
  loserId: string,
  survivorId: string,
): Promise<MergePreview> {
  const denied = await requireAdminCapability();
  if (denied) return denied;

  const [loser, survivor] = await Promise.all([
    prisma.region.findUnique({ where: { id: loserId }, select: { id: true, countryId: true, name: true } }),
    prisma.region.findUnique({ where: { id: survivorId }, select: { id: true, countryId: true, name: true } }),
  ]);
  if (!loser || !survivor) return { ok: false, message: "Region not found." };

  const invalid = validateRegionMergePair(loser, survivor);
  if (invalid) return { ok: false, message: mergeErrorMessage(invalid) };

  const [loserCities, survivorCities] = await Promise.all([
    prisma.city.findMany({ where: { regionId: loserId }, select: { id: true, nameNormalized: true } }),
    prisma.city.findMany({ where: { regionId: survivorId }, select: { id: true, nameNormalized: true } }),
  ]);
  const plan = planRegionMerge(loserCities, survivorCities);
  const loserCityIds = loserCities.map((c) => c.id);
  const addressesAffected =
    loserCityIds.length === 0
      ? 0
      : await prisma.address.count({ where: { cityId: { in: loserCityIds } } });

  return {
    ok: true,
    message: `Merging "${loser.name}" → "${survivor.name}": ${plan.cityRepoints.length} city(ies) repointed, ${plan.cityMerges.length} merged into same-named cities, ${addressesAffected} address(es) affected.`,
    impact: {
      citiesRepointed: plan.cityRepoints.length,
      citiesMerged: plan.cityMerges.length,
      addressesAffected,
    },
  };
}

export async function mergeRegion(
  loserId: string,
  survivorId: string,
): Promise<WorkforceActionResult> {
  const denied = await requireAdminCapability();
  if (denied) return denied;

  const [loser, survivor] = await Promise.all([
    prisma.region.findUnique({ where: { id: loserId }, select: { id: true, countryId: true, name: true } }),
    prisma.region.findUnique({ where: { id: survivorId }, select: { id: true, countryId: true } }),
  ]);
  if (!loser || !survivor) return { ok: false, message: "Region not found." };

  const invalid = validateRegionMergePair(loser, survivor);
  if (invalid) return { ok: false, message: mergeErrorMessage(invalid) };

  const [loserCities, survivorCities] = await Promise.all([
    prisma.city.findMany({ where: { regionId: loserId }, select: { id: true, nameNormalized: true } }),
    prisma.city.findMany({ where: { regionId: survivorId }, select: { id: true, nameNormalized: true } }),
  ]);
  const plan = planRegionMerge(loserCities, survivorCities);

  await prisma.$transaction(async (tx) => {
    // Collision cities: repoint their addresses to the survivor city, then tombstone.
    for (const { loserCityId, survivorCityId } of plan.cityMerges) {
      await tx.address.updateMany({ where: { cityId: loserCityId }, data: { cityId: survivorCityId } });
      await tx.city.update({
        where: { id: loserCityId },
        data: { status: SUPERSEDED_STATUS, mergedIntoId: survivorCityId },
      });
    }
    // Non-colliding cities: repoint into the survivor region.
    if (plan.cityRepoints.length > 0) {
      await tx.city.updateMany({
        where: { id: { in: plan.cityRepoints } },
        data: { regionId: survivorId },
      });
    }
    // Tombstone the loser region.
    await tx.region.update({
      where: { id: loserId },
      data: { status: SUPERSEDED_STATUS, mergedIntoId: survivorId },
    });
  });

  revalidateAdminPaths();
  return {
    ok: true,
    message: `Region "${loser.name}" merged and superseded (${plan.cityRepoints.length} repointed, ${plan.cityMerges.length} city merges).`,
  };
}
