import {
  ANIMAL_OCCUPANCY_DEMAND_SLUG,
  HOUSING_KIND_SLUGS,
  KENNEL_KIND_SLUG,
  buildWardBoard,
  type KennelRow,
  type OccupancyRow,
  type WardBoard,
} from "./ward-occupancy";

/**
 * Reads and writes for the ward board over the canonical capacity substrate.
 *
 * The client is narrowed to the calls actually made so the projection can be
 * exercised without a database, the way the archetype outcome facts already
 * are. Every read is scoped to one organization by its caller.
 */

/** `ResourceDomain` is a closed enum with no shelter value. `care` is the
 *  honest home: the care vertical became subject-agnostic in migration
 *  20260822164000, and animal welfare is care. Widening the enum is a
 *  migration and one archetype does not justify it. */
export const WARD_RESOURCE_DOMAIN = "care";

/**
 * `ResourceCapacityAllocation.endsAt` is required, and a shelter stay has no
 * known end — an animal leaves when it is adopted, returned, or transferred.
 * `releasedAt` is therefore the authoritative close and `endsAt` is only a
 * horizon far enough out that an open stay never looks expired. The canonical
 * substrate doc already flags long episodes as the thing that will stress this
 * model; a stay of years is exactly that case, and it is recorded here rather
 * than discovered later.
 */
export const OPEN_STAY_HORIZON_YEARS = 10;

export function openStayHorizon(from: Date): Date {
  const horizon = new Date(from);
  horizon.setFullYear(horizon.getFullYear() + OPEN_STAY_HORIZON_YEARS);
  return horizon;
}

interface FindMany<T> {
  (args: unknown): Promise<T[]>;
}

export interface WardStoreClient {
  resource?: { findMany: FindMany<KennelRow & { kindSlug?: string }> };
  resourceCapacityAllocation?: { findMany: FindMany<OccupancyRow> };
  adoptableAnimal?: { findMany: FindMany<{ animalRef: string; name: string; status: string }> };
}

/** Animals that have left are not population and are not placed. */
export function isInCare(status: string | null | undefined): boolean {
  return (status ?? "").toLowerCase() !== "adopted";
}

/**
 * Load the board. Returns `null` when the organization has no housing recorded
 * at all — a shelter that has never told the system about a kennel has not
 * answered "none free", and the caller must be able to tell those apart.
 */
export async function loadWardBoard(input: {
  organizationId: string;
  db: WardStoreClient;
}): Promise<WardBoard | null> {
  const { organizationId, db } = input;
  if (!db.resource?.findMany) return null;

  const kennels = await db.resource.findMany({
    where: {
      organizationId,
      kindSlug: { in: [...HOUSING_KIND_SLUGS] },
      lifecycle: "active",
    },
    select: {
      id: true,
      label: true,
      kindSlug: true,
      serviceArea: true,
      capacity: true,
      blockedReason: true,
      lifecycle: true,
      version: true,
    },
  });
  if (kennels.length === 0) return null;

  const [occupancy, animals] = await Promise.all([
    db.resourceCapacityAllocation?.findMany
      ? db.resourceCapacityAllocation.findMany({
          where: {
            organizationId,
            demandSlug: ANIMAL_OCCUPANCY_DEMAND_SLUG,
            releasedAt: null,
          },
          select: { id: true, resourceId: true, demandRef: true, startsAt: true, releasedAt: true },
        })
      : Promise.resolve([] as OccupancyRow[]),
    db.adoptableAnimal?.findMany
      ? db.adoptableAnimal.findMany({
          where: { organizationId },
          select: { animalRef: true, name: true, status: true },
        })
      : Promise.resolve([] as Array<{ animalRef: string; name: string; status: string }>),
  ]);

  const animalNames = new Map(
    animals.filter((animal) => isInCare(animal.status)).map((animal) => [animal.animalRef, animal.name]),
  );

  return buildWardBoard({ kennels, occupancy, animalNames });
}

/**
 * The kennels an archetype declares, turned into rows a shelter can use.
 *
 * A rescue should not have to invent its own housing model before the board
 * works, and the archetype already says what its housing is called and what a
 * unit holds. Labels are the shelter's to rename afterwards; these are a
 * starting roster, not a fixed layout.
 */
export function planSeedKennels(input: {
  organizationId: string;
  resourceKinds: ReadonlyArray<{ kindSlug: string; capacityUnit: string; maxCapacity: number }>;
  areas: ReadonlyArray<{ serviceArea: string; count: number; labelPrefix: string }>;
}): Array<{
  organizationId: string;
  resourceKey: string;
  domain: string;
  kindSlug: string;
  label: string;
  capacity: number;
  capacityUnit: string;
  serviceArea: string;
}> {
  const kennelKind = input.resourceKinds.find((kind) => kind.kindSlug === KENNEL_KIND_SLUG);
  if (!kennelKind) return [];

  const rows: ReturnType<typeof planSeedKennels> = [];
  for (const area of input.areas) {
    for (let index = 1; index <= area.count; index += 1) {
      const label = `${area.labelPrefix}${index}`;
      rows.push({
        organizationId: input.organizationId,
        // Stable and derivable, so re-seeding cannot double a roster.
        resourceKey: `kennel-${area.labelPrefix.toLowerCase()}${index}`,
        domain: WARD_RESOURCE_DOMAIN,
        kindSlug: KENNEL_KIND_SLUG,
        label,
        capacity: 1,
        capacityUnit: kennelKind.capacityUnit,
        serviceArea: area.serviceArea,
      });
    }
  }
  return rows;
}

/** The allocation that places an animal in a kennel. */
export function buildPlacement(input: {
  organizationId: string;
  kennelId: string;
  animalRef: string;
  now: Date;
}): {
  organizationId: string;
  domain: string;
  resourceId: string;
  demandSlug: string;
  demandRef: string;
  startsAt: Date;
  endsAt: Date;
  quantity: number;
  idempotencyKey: string;
} {
  return {
    organizationId: input.organizationId,
    domain: WARD_RESOURCE_DOMAIN,
    resourceId: input.kennelId,
    demandSlug: ANIMAL_OCCUPANCY_DEMAND_SLUG,
    demandRef: input.animalRef,
    startsAt: input.now,
    endsAt: openStayHorizon(input.now),
    quantity: 1,
    // One open stay per animal per move: a repeated place is the same move,
    // not a second animal in the run.
    idempotencyKey: `animal-occupancy:${input.animalRef}:${input.kennelId}:${input.now.toISOString()}`,
  };
}

/**
 * Moving an animal closes the stay it is leaving before opening the next.
 * Closing rather than deleting is what keeps housing a timeline, which is the
 * property contact tracing needs — the row that says an animal shared a ward
 * with the index case must survive the animal moving out of it.
 */
export function buildRelease(reason: "moved" | "left-care" | "corrected", now: Date): {
  releasedAt: Date;
  releaseReason: string;
} {
  return { releasedAt: now, releaseReason: reason };
}
