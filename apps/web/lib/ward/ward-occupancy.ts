import type { AnimalsInCare } from "@/lib/twin/archetype-outcomes";

/**
 * Where an animal sleeps, projected from the canonical capacity substrate.
 *
 * A kennel is a `Resource` (`kindSlug: "kennel"`, `capacityUnit: "animals"`) —
 * the same model a restaurant table and a treatment room already use. An animal
 * occupying one is a `ResourceCapacityAllocation` carrying
 * `demandSlug: "animal-occupancy"` and `demandRef: <animalRef>`. Neither needed
 * a new table; the operating-day run found the substrate built and unreached.
 *
 * The `demandRef` is deliberately the storefront animal's own stable key. When
 * an animal gains an identity independent of its listing (BI-4F8A484C), these
 * rows move by `sourceRef` backfill — the clone-to-canonical path the
 * hospitality → `Resource` migration already proved — rather than being rebuilt.
 */

export const ANIMAL_OCCUPANCY_DEMAND_SLUG = "animal-occupancy";
export const KENNEL_KIND_SLUG = "kennel";

export interface KennelRow {
  id: string;
  label: string;
  /** Ward, room or site. Absent means the shelter never grouped its housing. */
  serviceArea: string | null;
  capacity: number;
  /** Set while a unit is out of service — deep clean, repair, quarantine. */
  blockedReason: string | null;
  lifecycle: string;
}

export interface OccupancyRow {
  resourceId: string | null;
  demandRef: string;
  startsAt: Date;
  releasedAt: Date | null;
}

export interface WardUnit {
  kennelId: string;
  label: string;
  /** `null` when free, or when the occupant's animal row has since gone. */
  animalRef: string | null;
  animalName: string | null;
  since: Date | null;
  blockedReason: string | null;
  state: "occupied" | "free" | "out-of-service";
}

export interface WardZone {
  /** The shelter's own name for the area. Never invented. */
  area: string;
  units: WardUnit[];
  occupied: number;
  free: number;
  outOfService: number;
}

export interface WardBoard {
  zones: WardZone[];
  totalUnits: number;
  occupied: number;
  free: number;
  outOfService: number;
  /** Animals in care with no kennel recorded — the shelter knows it has them
   *  and cannot say where they are. Surfaced, never silently dropped. */
  unplaced: Array<{ animalRef: string; name: string }>;
}

/** An area label every shelter can read, for housing that was never grouped. */
export const UNGROUPED_AREA = "Unassigned area";

function unitState(kennel: KennelRow, occupantRef: string | null): WardUnit["state"] {
  if (kennel.blockedReason) return "out-of-service";
  return occupantRef ? "occupied" : "free";
}

/**
 * Build the board. Pure: every input is already scoped to one organization by
 * its caller, and nothing here reads or writes.
 *
 * An allocation with a `releasedAt` is history — the animal has left that unit —
 * so only open ones place anybody. That is what makes housing a timeline rather
 * than a current-location field, which is the property contact tracing needs
 * (§2, the parvo case) even though tracing itself is not built yet.
 */
export function buildWardBoard(input: {
  kennels: KennelRow[];
  occupancy: OccupancyRow[];
  animalNames: Map<string, string>;
}): WardBoard {
  const open = input.occupancy.filter((row) => row.releasedAt == null && row.resourceId);

  // Last one wins if a unit somehow holds two open allocations: showing the most
  // recent is closer to the truth than showing an arbitrary one, and the double
  // booking still surfaces because the earlier animal lands in `unplaced`.
  const byKennel = new Map<string, OccupancyRow>();
  for (const row of open) {
    const current = byKennel.get(row.resourceId!);
    if (!current || row.startsAt > current.startsAt) byKennel.set(row.resourceId!, row);
  }

  const placedRefs = new Set([...byKennel.values()].map((row) => row.demandRef));
  const zones = new Map<string, WardZone>();

  for (const kennel of input.kennels) {
    const area = kennel.serviceArea?.trim() || UNGROUPED_AREA;
    const occupant = byKennel.get(kennel.id) ?? null;
    const animalRef = occupant?.demandRef ?? null;
    // An occupant whose animal row is gone leaves the unit reading free rather
    // than naming a ghost.
    const animalName = animalRef ? input.animalNames.get(animalRef) ?? null : null;
    const effectiveRef = animalName ? animalRef : null;
    const state = unitState(kennel, effectiveRef);

    const unit: WardUnit = {
      kennelId: kennel.id,
      label: kennel.label,
      animalRef: effectiveRef,
      animalName,
      since: effectiveRef ? occupant?.startsAt ?? null : null,
      blockedReason: kennel.blockedReason,
      state,
    };

    const zone = zones.get(area) ?? { area, units: [], occupied: 0, free: 0, outOfService: 0 };
    zone.units.push(unit);
    if (state === "occupied") zone.occupied += 1;
    else if (state === "out-of-service") zone.outOfService += 1;
    else zone.free += 1;
    zones.set(area, zone);
  }

  const unplaced = [...input.animalNames.entries()]
    .filter(([ref]) => !placedRefs.has(ref))
    .map(([animalRef, name]) => ({ animalRef, name }));

  const ordered = [...zones.values()].sort((a, b) => a.area.localeCompare(b.area));
  for (const zone of ordered) zone.units.sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));

  return {
    zones: ordered,
    totalUnits: input.kennels.length,
    occupied: ordered.reduce((sum, zone) => sum + zone.occupied, 0),
    free: ordered.reduce((sum, zone) => sum + zone.free, 0),
    outOfService: ordered.reduce((sum, zone) => sum + zone.outOfService, 0),
    unplaced,
  };
}

/**
 * The 16:00 question the operating-day run could not answer: how many kennels
 * are free. `null` means no housing is recorded at all — a shelter with no
 * kennels has not answered "none free", it has not been asked yet, and the two
 * must not render the same.
 */
export function summarizeKennelCapacity(board: WardBoard | null): {
  total: number;
  free: number;
  occupied: number;
  outOfService: number;
} | null {
  if (!board || board.totalUnits === 0) return null;
  return {
    total: board.totalUnits,
    free: board.free,
    occupied: board.occupied,
    outOfService: board.outOfService,
  };
}

/**
 * Animals the shelter is holding but cannot locate. A rescue that has kennels
 * and unplaced animals has a real gap in its own records, and the board says so
 * rather than quietly showing a smaller population than the cockpit does.
 */
export function reconcileAgainstPopulation(
  board: WardBoard | null,
  inCare: AnimalsInCare | null,
): { placed: number; unplaced: number; inCare: number } | null {
  if (!board || !inCare) return null;
  return {
    placed: board.occupied,
    unplaced: board.unplaced.length,
    inCare: inCare.total,
  };
}
