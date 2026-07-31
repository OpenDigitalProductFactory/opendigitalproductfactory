import type { HospitalityAllocationLifecycle } from "./hospitality-capacity";
import { parseRestaurantTableAttributes } from "./restaurant-table-attributes";

export interface RestaurantSeatingResourceFact {
  id: string;
  label: string;
  status: string;
  capacity: number;
  version: number;
  attributes: unknown;
}

export interface RestaurantSeatingAllocationFact {
  id: string;
  resourceId: string | null;
  startsAt: Date;
  endsAt: Date;
  lifecycle: HospitalityAllocationLifecycle;
  version: number;
  demandRef?: string;
}

export interface RestaurantSeatingDemandVersionFact {
  id: string;
  updatedAt: Date;
  status: string;
}

export type RestaurantSeatingDecision =
  | { ok: true; capacity: number }
  | { ok: false; reasonCode: string; message: string };

const LIVE_ALLOCATION_LIFECYCLES = new Set<HospitalityAllocationLifecycle>([
  "reserved",
  "active",
]);

function intervalsOverlap(
  leftStart: Date,
  leftEnd: Date,
  rightStart: Date,
  rightEnd: Date,
): boolean {
  return (
    leftStart.getTime() < rightEnd.getTime() &&
    rightStart.getTime() < leftEnd.getTime()
  );
}

function pairCanCombine(
  left: RestaurantSeatingResourceFact,
  right: RestaurantSeatingResourceFact,
): boolean {
  const leftAttributes = parseRestaurantTableAttributes(left.attributes);
  const rightAttributes = parseRestaurantTableAttributes(right.attributes);
  if (
    leftAttributes.combinationGroup &&
    leftAttributes.combinationGroup === rightAttributes.combinationGroup
  ) {
    return true;
  }
  return (
    leftAttributes.combinableWith.includes(right.id) &&
    rightAttributes.combinableWith.includes(left.id)
  );
}

export function evaluateRestaurantSeating(input: {
  covers: number;
  resources: readonly RestaurantSeatingResourceFact[];
  allocations: readonly RestaurantSeatingAllocationFact[];
  startsAt: Date;
  endsAt: Date;
  demandRef?: string;
}): RestaurantSeatingDecision {
  if (
    !Number.isInteger(input.covers) ||
    input.covers <= 0 ||
    !Number.isFinite(input.startsAt.getTime()) ||
    !Number.isFinite(input.endsAt.getTime()) ||
    input.endsAt.getTime() <= input.startsAt.getTime()
  ) {
    return {
      ok: false,
      reasonCode: "invalid-seating-request",
      message: "Party size and seating interval must be valid.",
    };
  }
  if (
    input.resources.length === 0 ||
    new Set(input.resources.map((resource) => resource.id)).size !==
      input.resources.length
  ) {
    return {
      ok: false,
      reasonCode: "invalid-table-selection",
      message: "Choose one or more distinct tables.",
    };
  }
  const unavailable = input.resources.find(
    (resource) => resource.status !== "active",
  );
  if (unavailable) {
    return {
      ok: false,
      reasonCode: "table-unavailable",
      message: `${unavailable.label} is not available for seating.`,
    };
  }

  const selectedIds = new Set(input.resources.map((resource) => resource.id));
  const conflict = input.allocations.find(
    (allocation) =>
      allocation.resourceId != null &&
      selectedIds.has(allocation.resourceId) &&
      !(
        input.demandRef !== undefined &&
        allocation.demandRef === input.demandRef
      ) &&
      LIVE_ALLOCATION_LIFECYCLES.has(allocation.lifecycle) &&
      intervalsOverlap(
        allocation.startsAt,
        allocation.endsAt,
        input.startsAt,
        input.endsAt,
      ),
  );
  if (conflict) {
    return {
      ok: false,
      reasonCode: "table-conflict",
      message: "One or more selected tables are already committed in that time.",
    };
  }

  const capacity = input.resources.reduce(
    (total, resource) => total + resource.capacity,
    0,
  );
  if (capacity < input.covers) {
    return {
      ok: false,
      reasonCode: "insufficient-capacity",
      message: `The selected tables seat ${capacity}, fewer than the party of ${input.covers}.`,
    };
  }
  for (let left = 0; left < input.resources.length; left += 1) {
    for (let right = left + 1; right < input.resources.length; right += 1) {
      if (!pairCanCombine(input.resources[left], input.resources[right])) {
        return {
          ok: false,
          reasonCode: "tables-not-combinable",
          message: "The selected tables are not configured to combine.",
        };
      }
    }
  }
  return { ok: true, capacity };
}

export interface RestaurantSeatingAlternative {
  resourceIds: string[];
  label: string;
}

/**
 * Computes bounded, actionable alternatives from the same rules the write
 * transaction enforces. Singles and configured pairs cover the host-stand hot
 * path without generating an unbounded combination search.
 */
export function findRestaurantSeatingAlternatives(input: {
  covers: number;
  resources: readonly RestaurantSeatingResourceFact[];
  allocations: readonly RestaurantSeatingAllocationFact[];
  startsAt: Date;
  endsAt: Date;
  demandRef?: string;
  excludeResourceIds?: readonly string[];
  limit?: number;
}): RestaurantSeatingAlternative[] {
  const candidates: RestaurantSeatingResourceFact[][] = input.resources.map(
    (resource) => [resource],
  );
  for (let left = 0; left < input.resources.length; left += 1) {
    for (let right = left + 1; right < input.resources.length; right += 1) {
      candidates.push([input.resources[left], input.resources[right]]);
    }
  }
  const excludedKey = [...(input.excludeResourceIds ?? [])].sort().join(",");
  const valid = candidates.flatMap((resources) => {
    const key = resources.map((resource) => resource.id).sort().join(",");
    if (key === excludedKey) return [];
    const decision = evaluateRestaurantSeating({
      covers: input.covers,
      resources,
      allocations: input.allocations,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      ...(input.demandRef ? { demandRef: input.demandRef } : {}),
    });
    return decision.ok
      ? [{
          capacity: decision.capacity,
          resourceIds: resources.map((resource) => resource.id),
          label: resources.map((resource) => resource.label).join(" + "),
        }]
      : [];
  });
  valid.sort(
    (left, right) =>
      left.capacity - right.capacity ||
      left.resourceIds.length - right.resourceIds.length ||
      left.label.localeCompare(right.label),
  );
  return valid.slice(0, input.limit ?? 3).map(
    ({ resourceIds, label }) => ({ resourceIds, label }),
  );
}

function fnv1a(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

/**
 * Opaque optimistic token over every fact the seating transaction rechecks.
 * Sorting makes query order irrelevant; changing demand, table, or live
 * allocation state changes the token.
 */
export function restaurantSeatingVersion(input: {
  demand: RestaurantSeatingDemandVersionFact;
  resources: readonly RestaurantSeatingResourceFact[];
  allocations: readonly RestaurantSeatingAllocationFact[];
}): string {
  return `restaurant-seat.v1-${fnv1a(
    JSON.stringify({
      demand: {
        id: input.demand.id,
        status: input.demand.status,
        updatedAt: input.demand.updatedAt.toISOString(),
      },
      resources: input.resources
        .map((resource) => ({
          id: resource.id,
          status: resource.status,
          version: resource.version,
        }))
        .sort((left, right) => left.id.localeCompare(right.id)),
      allocations: input.allocations
        .filter((allocation) =>
          LIVE_ALLOCATION_LIFECYCLES.has(allocation.lifecycle)
        )
        .map((allocation) => ({
          id: allocation.id,
          resourceId: allocation.resourceId,
          lifecycle: allocation.lifecycle,
          version: allocation.version,
          startsAt: allocation.startsAt.toISOString(),
          endsAt: allocation.endsAt.toISOString(),
        }))
        .sort((left, right) => left.id.localeCompare(right.id)),
    }),
  )}`;
}
