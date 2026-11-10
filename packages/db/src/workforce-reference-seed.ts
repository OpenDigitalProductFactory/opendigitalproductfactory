import type { PrismaClient } from "../generated/client/client";

/**
 * The worker classes every install starts with.
 *
 * `Volunteer` belongs here rather than in one archetype: `WorkerClassification`
 * already carries `volunteer` and names it "the majority classification for
 * nonprofit and community archetypes", and running a rescue found the platform
 * could not record one at all (BI-A30152B6). A class an archetype's day needs on
 * top of these is declared on the archetype and applied per organization — see
 * `workforceProfile` in @dpf/storefront-templates.
 *
 * `classification` is written on create only, never on update: it is a legal
 * determination, and the operator's answer outranks the seed's. The four
 * pre-existing rows that carry no classification are left alone for the same
 * reason.
 */
export function getDefaultEmploymentTypes() {
  return [
    { employmentTypeId: "emp-full-time", name: "Full-time" },
    { employmentTypeId: "emp-part-time", name: "Part-time" },
    { employmentTypeId: "emp-contractor", name: "Contractor" },
    { employmentTypeId: "emp-intern", name: "Intern" },
    { employmentTypeId: "emp-advisor", name: "Advisor" },
    { employmentTypeId: "emp-volunteer", name: "Volunteer", classification: "volunteer" },
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
