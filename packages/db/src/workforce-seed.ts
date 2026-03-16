import type { PrismaClient } from "../generated/client";

export function getDefaultEmploymentTypes() {
  return [
    { employmentTypeId: "emp-full-time", name: "Full-time" },
    { employmentTypeId: "emp-part-time", name: "Part-time" },
    { employmentTypeId: "emp-contractor", name: "Contractor" },
    { employmentTypeId: "emp-intern", name: "Intern" },
    { employmentTypeId: "emp-advisor", name: "Advisor" },
  ] as const;
}

export function getDefaultWorkLocations() {
  return [
    {
      locationId: "loc-hq",
      name: "Headquarters",
      locationType: "office",
      timezone: "America/Chicago",
    },
    {
      locationId: "loc-remote",
      name: "Remote",
      locationType: "remote",
      timezone: null,
    },
    {
      locationId: "loc-hybrid",
      name: "Hybrid",
      locationType: "hybrid",
      timezone: null,
    },
  ] as const;
}

export async function seedWorkforceReferenceData(prisma: PrismaClient): Promise<void> {
  for (const employmentType of getDefaultEmploymentTypes()) {
    await prisma.employmentType.upsert({
      where: { employmentTypeId: employmentType.employmentTypeId },
      update: {
        name: employmentType.name,
        status: "active",
      },
      create: {
        ...employmentType,
        status: "active",
      },
    });
  }

  for (const workLocation of getDefaultWorkLocations()) {
    await prisma.workLocation.upsert({
      where: { locationId: workLocation.locationId },
      update: {
        name: workLocation.name,
        locationType: workLocation.locationType,
        timezone: workLocation.timezone,
        status: "active",
      },
      create: {
        ...workLocation,
        status: "active",
      },
    });
  }
}
