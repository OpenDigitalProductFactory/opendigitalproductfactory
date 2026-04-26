"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { prisma } from "@dpf/db";
import {
  createLocality,
  forceCreateLocality,
  searchCountriesForLocation,
  searchLocalities,
  searchRegionsForLocation,
} from "@/lib/location-resolution/service";

async function requireAuth(): Promise<void> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Not authenticated");
}

export type CreateRefResult = {
  ok: boolean;
  message: string;
  created?: { id: string; name: string; code?: string | null };
  suggestions?: { id: string; name: string; code?: string | null }[];
};

// ---------------------------------------------------------------------------
// Search actions — delegate to location-resolution service
// ---------------------------------------------------------------------------

export async function searchCountries(query: string) {
  await requireAuth();
  return searchCountriesForLocation(query);
}

export async function searchRegions(countryId: string, query: string) {
  await requireAuth();
  return searchRegionsForLocation(countryId, query);
}

export async function searchCities(regionId: string, query: string) {
  await requireAuth();
  return searchLocalities(regionId, query);
}

// ---------------------------------------------------------------------------
// Create actions
// ---------------------------------------------------------------------------

export async function createRegion(
  countryId: string,
  name: string,
  code?: string,
): Promise<CreateRefResult> {
  await requireAuth();
  const trimmedName = name.trim();
  if (!trimmedName) {
    return { ok: false, message: "Region name is required." };
  }

  const trimmedCode = code?.trim() || null;

  // Near-match check: case-insensitive prefix match
  const matches = await prisma.region.findMany({
    where: {
      countryId,
      status: "active",
      name: { startsWith: trimmedName, mode: "insensitive" },
    },
    select: { id: true, name: true, code: true },
    orderBy: { name: "asc" },
  });

  if (matches.length > 0) {
    return {
      ok: false,
      message: `Similar regions already exist. Did you mean one of these?`,
      suggestions: matches,
    };
  }

  const created = await prisma.region.create({
    data: {
      name: trimmedName,
      code: trimmedCode,
      countryId,
      status: "active",
    },
    select: { id: true, name: true, code: true },
  });

  revalidatePath("/employee");
  revalidatePath("/admin/reference-data");
  return { ok: true, message: `Region "${created.name}" created.`, created };
}

export async function createCity(
  regionId: string,
  name: string,
): Promise<CreateRefResult> {
  await requireAuth();
  const result = await createLocality({ regionId, name });
  revalidatePath("/employee");
  revalidatePath("/admin/reference-data");
  return result;
}

// ---------------------------------------------------------------------------
// Force-create actions (bypass near-match check)
// ---------------------------------------------------------------------------

export async function forceCreateRegion(
  countryId: string,
  name: string,
  code?: string,
): Promise<CreateRefResult> {
  await requireAuth();
  const trimmedName = name.trim();
  if (!trimmedName) {
    return { ok: false, message: "Region name is required." };
  }

  const trimmedCode = code?.trim() || null;

  const created = await prisma.region.create({
    data: {
      name: trimmedName,
      code: trimmedCode,
      countryId,
      status: "active",
    },
    select: { id: true, name: true, code: true },
  });

  revalidatePath("/employee");
  revalidatePath("/admin/reference-data");
  return { ok: true, message: `Region "${created.name}" created.`, created };
}

export async function forceCreateCity(
  regionId: string,
  name: string,
): Promise<CreateRefResult> {
  await requireAuth();
  const result = await forceCreateLocality({ regionId, name });
  revalidatePath("/employee");
  revalidatePath("/admin/reference-data");
  return result;
}
