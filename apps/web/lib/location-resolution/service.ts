import { prisma } from "@dpf/db";
import { normalizeLocalityName } from "./normalize";
import {
  DEFAULT_LOCALITY_SOURCE,
  DEFAULT_LOCALITY_TYPE,
  LOCALITY_STATUSES,
  type LocalityStatus,
} from "./locality-enums";

export type LocationRefResult = {
  ok: boolean;
  message: string;
  created?: { id: string; name: string; code?: string | null; status?: LocalityStatus };
  suggestions?: { id: string; name: string; code?: string | null }[];
};

export type CreateLocalityInput = {
  regionId: string;
  name: string;
  addedByUserId?: string | null;
};

function toLocalityStatus(status: string): LocalityStatus | undefined {
  return LOCALITY_STATUSES.includes(status as LocalityStatus) ? (status as LocalityStatus) : undefined;
}

export async function searchCountriesForLocation(query: string) {
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

export async function searchRegionsForLocation(countryId: string, query: string) {
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

export async function searchLocalities(regionId: string, query: string) {
  const trimmed = query.trim();
  if (!trimmed) return [];

  return prisma.city.findMany({
    where: {
      regionId,
      status: { in: ["active", "needs-review"] },
      name: { contains: trimmed, mode: "insensitive" },
    },
    select: { id: true, name: true, status: true },
    orderBy: { name: "asc" },
    take: 20,
  });
}

export async function suggestDuplicateLocalities(regionId: string, name: string) {
  const trimmed = name.trim();
  if (!trimmed) return [];
  const normalized = normalizeLocalityName(trimmed);

  const candidates = await prisma.city.findMany({
    where: {
      regionId,
      status: "active",
      name: { contains: trimmed.slice(0, Math.min(trimmed.length, 6)), mode: "insensitive" },
    },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
    take: 50,
  });

  return candidates.filter((candidate) => normalizeLocalityName(candidate.name) === normalized);
}

export async function createLocality(input: CreateLocalityInput): Promise<LocationRefResult> {
  const trimmedName = input.name.trim();
  if (!trimmedName) {
    return { ok: false, message: "Town / city name is required." };
  }

  const suggestions = await suggestDuplicateLocalities(input.regionId, trimmedName);
  if (suggestions.length > 0) {
    return {
      ok: false,
      message: "Similar localities already exist. Did you mean one of these?",
      suggestions,
    };
  }

  const created = await prisma.city.create({
    data: {
      name: trimmedName,
      nameNormalized: normalizeLocalityName(trimmedName),
      regionId: input.regionId,
      status: "needs-review",
      localityType: DEFAULT_LOCALITY_TYPE,
      source: DEFAULT_LOCALITY_SOURCE,
      ...(input.addedByUserId ? { addedByUserId: input.addedByUserId } : {}),
    },
    select: { id: true, name: true, status: true },
  });

  return {
    ok: true,
    message: `Town / city "${created.name}" was added for review.`,
    created: { ...created, status: toLocalityStatus(created.status) },
  };
}

export async function forceCreateLocality(input: CreateLocalityInput): Promise<LocationRefResult> {
  const trimmedName = input.name.trim();
  if (!trimmedName) {
    return { ok: false, message: "Town / city name is required." };
  }

  const created = await prisma.city.create({
    data: {
      name: trimmedName,
      nameNormalized: normalizeLocalityName(trimmedName),
      regionId: input.regionId,
      status: "active",
      localityType: DEFAULT_LOCALITY_TYPE,
      source: DEFAULT_LOCALITY_SOURCE,
      ...(input.addedByUserId ? { addedByUserId: input.addedByUserId } : {}),
    },
    select: { id: true, name: true, status: true },
  });

  return {
    ok: true,
    message: `Town / city "${created.name}" created.`,
    created: { ...created, status: toLocalityStatus(created.status) },
  };
}
