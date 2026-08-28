// Apply the active archetype's worker classes and work locations (BI-A30152B6).
//
// `seedWorkforceReferenceData` in @dpf/db seeds what every install starts with:
// Full-time, Part-time, Contractor, Intern, Advisor, Volunteer, and
// Headquarters / Remote / Hybrid. Running a rescue for a day found that none of
// the three locations describes anywhere an animal lives, and that a shelter's
// second unpaid class — the foster carer who houses an animal off-site — had
// nowhere to be recorded.
//
// `EmploymentType` and `WorkLocation` are open tables, not enums, so an
// archetype contributes rows rather than the platform widening a closed set.
// This step reads the archetype the install actually runs and applies only that
// archetype's rows, so a restaurant never acquires a cat room.
//
// Idempotent, and additive only: an operator who renames or retires a row keeps
// their edit, and `classification` is written on create only, because it is a
// legal determination and the operator's answer outranks the seed's.

import { prisma } from "@dpf/db";
import { ALL_ARCHETYPES, type WorkforceProfile } from "@dpf/storefront-templates";

export type SeedArchetypeWorkforceClient = {
  storefrontConfig: { findFirst: (args: unknown) => Promise<{ archetypeId: string } | null> };
  employmentType: {
    findUnique: (args: unknown) => Promise<{ id: string } | null>;
    create: (args: unknown) => Promise<unknown>;
  };
  workLocation: {
    findUnique: (args: unknown) => Promise<{ id: string } | null>;
    create: (args: unknown) => Promise<unknown>;
  };
};

export type SeedArchetypeWorkforceInput = {
  organizationId: string;
  db?: SeedArchetypeWorkforceClient;
};

export type SeedArchetypeWorkforceResult = {
  archetypeId: string | null;
  employmentTypesAdded: string[];
  workLocationsAdded: string[];
};

export function workforceProfileFor(archetypeId: string | null): WorkforceProfile | null {
  if (!archetypeId) return null;
  const archetype = ALL_ARCHETYPES.find((a) => a.archetypeId === archetypeId);
  return archetype?.workforceProfile ?? null;
}

export async function seedArchetypeWorkforce({
  organizationId,
  db,
}: SeedArchetypeWorkforceInput): Promise<SeedArchetypeWorkforceResult> {
  const client = (db ?? (prisma as unknown)) as SeedArchetypeWorkforceClient;

  const config = await client.storefrontConfig.findFirst({
    where: { organizationId },
    select: { archetypeId: true },
  });
  const archetypeId = config?.archetypeId ?? null;
  const profile = workforceProfileFor(archetypeId);

  const employmentTypesAdded: string[] = [];
  const workLocationsAdded: string[] = [];
  if (!profile) return { archetypeId, employmentTypesAdded, workLocationsAdded };

  for (const employmentType of profile.employmentTypes ?? []) {
    const existing = await client.employmentType.findUnique({
      where: { employmentTypeId: employmentType.employmentTypeId },
      select: { id: true },
    });
    if (existing) continue;
    await client.employmentType.create({
      data: { ...employmentType, status: "active" },
    });
    employmentTypesAdded.push(employmentType.employmentTypeId);
  }

  for (const workLocation of profile.workLocations ?? []) {
    const existing = await client.workLocation.findUnique({
      where: { locationId: workLocation.locationId },
      select: { id: true },
    });
    if (existing) continue;
    await client.workLocation.create({
      data: { ...workLocation, status: "active" },
    });
    workLocationsAdded.push(workLocation.locationId);
  }

  return { archetypeId, employmentTypesAdded, workLocationsAdded };
}

/**
 * Boot reconciler for the archetype's workforce rows.
 *
 * `runSetupCompletionSeeds` runs at setup completion and from the WWWD boot
 * backfill — but that backfill short-circuits on a healthy corpus, so an install
 * that finished onboarding before this existed would never acquire the rows and
 * nothing would self-heal it. This mirrors `backfillOperationalValueStreamsOnBoot`:
 * cheap once healed (one storefront read plus an existence check per declared
 * row, no writes), idempotent, and non-fatal per organization.
 */
export async function backfillArchetypeWorkforceOnBoot(
  logger: Pick<Console, "log" | "warn"> = console,
): Promise<{ seeded: number; present: number }> {
  const result = { seeded: 0, present: 0 };
  const organizations = await prisma.organization.findMany({ select: { id: true } });

  for (const organization of organizations) {
    try {
      const applied = await seedArchetypeWorkforce({ organizationId: organization.id });
      const added = applied.employmentTypesAdded.length + applied.workLocationsAdded.length;
      if (added === 0) {
        result.present++;
        continue;
      }
      result.seeded++;
      logger.log(
        `[archetype-workforce] org ${organization.id} (${applied.archetypeId}): added ` +
          `${applied.employmentTypesAdded.length} worker class(es), ` +
          `${applied.workLocationsAdded.length} work location(s)`,
      );
    } catch (err) {
      logger.warn(`[archetype-workforce] org ${organization.id}: seed failed (non-fatal):`, err);
    }
  }
  return result;
}
