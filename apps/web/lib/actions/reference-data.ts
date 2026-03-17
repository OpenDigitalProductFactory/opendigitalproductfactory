"use server";

import { prisma } from "@dpf/db";
import { revalidatePath } from "next/cache";

export type CreateRefResult = {
  ok: boolean;
  message: string;
  created?: { id: string; name: string; code?: string | null };
  suggestions?: { id: string; name: string; code?: string | null }[];
};

// ---------------------------------------------------------------------------
// Search actions
// ---------------------------------------------------------------------------

export async function searchCountries(query: string) {
  const trimmed = query.trim();
  if (!trimmed) return [];

  return prisma.country.findMany({
    where: {
      status: "active",
      OR: [
        { name: { contains: trimmed, mode: "insensitive" } },
        { iso2: { contains: trimmed, mode: "insensitive" } },
        { iso3: { contains: trimmed, mode: "insensitive" } },
      ],
    },
    select: { id: true, name: true, iso2: true, iso3: true, phoneCode: true },
    orderBy: { name: "asc" },
    take: 20,
  });
}

export async function searchRegions(countryId: string, query: string) {
  const trimmed = query.trim();
  if (!trimmed) return [];

  return prisma.region.findMany({
    where: {
      countryId,
      status: "active",
      OR: [
        { name: { contains: trimmed, mode: "insensitive" } },
        { code: { contains: trimmed, mode: "insensitive" } },
      ],
    },
    select: { id: true, name: true, code: true },
    orderBy: { name: "asc" },
    take: 20,
  });
}

export async function searchCities(regionId: string, query: string) {
  const trimmed = query.trim();
  if (!trimmed) return [];

  return prisma.city.findMany({
    where: {
      regionId,
      status: "active",
      name: { contains: trimmed, mode: "insensitive" },
    },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
    take: 20,
  });
}

// ---------------------------------------------------------------------------
// Create actions (with near-match duplicate prevention)
// ---------------------------------------------------------------------------

export async function createRegion(
  countryId: string,
  name: string,
  code?: string,
): Promise<CreateRefResult> {
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
  return { ok: true, message: `Region "${created.name}" created.`, created };
}

export async function createCity(
  regionId: string,
  name: string,
): Promise<CreateRefResult> {
  const trimmedName = name.trim();
  if (!trimmedName) {
    return { ok: false, message: "City name is required." };
  }

  // Near-match check: case-insensitive prefix match
  const matches = await prisma.city.findMany({
    where: {
      regionId,
      status: "active",
      name: { startsWith: trimmedName, mode: "insensitive" },
    },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  if (matches.length > 0) {
    return {
      ok: false,
      message: `Similar cities already exist. Did you mean one of these?`,
      suggestions: matches,
    };
  }

  const created = await prisma.city.create({
    data: {
      name: trimmedName,
      regionId,
      status: "active",
    },
    select: { id: true, name: true },
  });

  revalidatePath("/employee");
  return { ok: true, message: `City "${created.name}" created.`, created };
}

// ---------------------------------------------------------------------------
// Force-create actions (bypass near-match check)
// ---------------------------------------------------------------------------

export async function forceCreateRegion(
  countryId: string,
  name: string,
  code?: string,
): Promise<CreateRefResult> {
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
  return { ok: true, message: `Region "${created.name}" created.`, created };
}

export async function forceCreateCity(
  regionId: string,
  name: string,
): Promise<CreateRefResult> {
  const trimmedName = name.trim();
  if (!trimmedName) {
    return { ok: false, message: "City name is required." };
  }

  const created = await prisma.city.create({
    data: {
      name: trimmedName,
      regionId,
      status: "active",
    },
    select: { id: true, name: true },
  });

  revalidatePath("/employee");
  return { ok: true, message: `City "${created.name}" created.`, created };
}
