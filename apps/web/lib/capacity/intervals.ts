import {
  capacityResourceRefKey,
  type CapacityAllocation,
  type CapacityAttentionSignal,
  type CapacityConflict,
  type CapacityDemand,
  type CapacityInterval,
  type CapacityResource,
  type CapacityWindow,
} from "./contracts";

const MINUTE_MS = 60_000;
const CONSUMING_LIFECYCLES = new Set<CapacityAllocation["lifecycle"]>([
  "held",
  "confirmed",
  "active",
]);

function epoch(value: string): number {
  const result = Date.parse(value);
  if (!Number.isFinite(result)) throw new Error(`Invalid capacity timestamp: ${value}`);
  return result;
}

function windowBounds(window: CapacityWindow): { startMs: number; endMs: number } {
  const startMs = epoch(window.startAt);
  const endMs = epoch(window.endAt);
  if (endMs <= startMs) throw new Error("Capacity interval end must be after start");
  return { startMs, endMs };
}

export function capacityFootprint(interval: CapacityInterval): {
  startMs: number;
  endMs: number;
} {
  const { startMs, endMs } = windowBounds(interval);
  const before = Math.max(0, interval.travelBeforeMinutes) + Math.max(0, interval.preparationMinutes);
  const after = Math.max(0, interval.cleanupMinutes) + Math.max(0, interval.travelAfterMinutes);
  return {
    startMs: startMs - before * MINUTE_MS,
    endMs: endMs + after * MINUTE_MS,
  };
}

export function intervalsOverlap(left: CapacityInterval, right: CapacityInterval): boolean {
  const a = capacityFootprint(left);
  const b = capacityFootprint(right);
  return a.startMs < b.endMs && b.startMs < a.endMs;
}

function sameResource(resource: CapacityResource, allocation: CapacityAllocation): boolean {
  return capacityResourceRefKey(resource.ref) === capacityResourceRefKey(allocation.resourceRef);
}

export function evaluateCapacityDemand(input: {
  resource: CapacityResource;
  allocations: readonly CapacityAllocation[];
  demand: CapacityDemand;
}): CapacityConflict[] {
  const conflicts: CapacityConflict[] = [];
  const base = {
    resourceRef: input.resource.ref,
    demandRef: input.demand.demandRef,
    conflictingAllocationIds: [] as string[],
  };

  if (input.resource.status === "blocked" || input.resource.status === "offline" || input.resource.status === "unknown") {
    conflicts.push({ ...base, kind: "unavailable", detail: `${input.resource.label} is ${input.resource.status}` });
  }

  const missingCapabilities = input.demand.requiredCapabilityKeys.filter(
    (capability) => !input.resource.capabilityKeys.includes(capability),
  );
  if (missingCapabilities.length > 0) {
    conflicts.push({
      ...base,
      kind: "capability-mismatch",
      detail: `Missing capabilities: ${missingCapabilities.join(", ")}`,
    });
  }

  const requiredTravel = Math.max(0, input.demand.interval.travelBeforeMinutes) +
    Math.max(0, input.demand.interval.travelAfterMinutes);
  if (input.demand.availableTravelMinutes !== undefined && requiredTravel > input.demand.availableTravelMinutes) {
    conflicts.push({
      ...base,
      kind: "travel-window",
      detail: `${requiredTravel} travel minutes required; ${input.demand.availableTravelMinutes} available`,
    });
  }

  const overlapping = input.allocations.filter(
    (allocation) =>
      CONSUMING_LIFECYCLES.has(allocation.lifecycle) &&
      sameResource(input.resource, allocation) &&
      intervalsOverlap(allocation.interval, input.demand.interval),
  );
  if (overlapping.length > 0) {
    conflicts.push({
      ...base,
      kind: "time-overlap",
      conflictingAllocationIds: overlapping.map((allocation) => allocation.allocationId),
      detail: `${overlapping.length} consuming allocation(s) overlap the requested footprint`,
    });
  }

  const consumed = overlapping.reduce((total, allocation) => total + Math.max(0, allocation.quantity), 0);
  if (consumed + Math.max(0, input.demand.quantity) > Math.max(0, input.resource.capacity)) {
    conflicts.push({
      ...base,
      kind: "capacity-exceeded",
      conflictingAllocationIds: overlapping.map((allocation) => allocation.allocationId),
      detail: `${consumed + input.demand.quantity} ${input.resource.capacityUnit} requested; ${input.resource.capacity} available`,
    });
  }

  return conflicts;
}

/** Translate source-neutral conflicts into the shared owner-attention carrier. */
export function capacityConflictsToAttentionSignals(
  conflicts: readonly CapacityConflict[],
): CapacityAttentionSignal[] {
  return conflicts.map((conflict, index) => ({
    signalId: `${conflict.kind}:${capacityResourceRefKey(conflict.resourceRef)}:${conflict.demandRef}:${index}`,
    kind: conflict.kind,
    authority: conflict.resourceRef.authority,
    resourceRef: conflict.resourceRef,
    demandRef: conflict.demandRef,
    detail: conflict.detail,
  }));
}

export function utilizationPercent(input: {
  resource: CapacityResource;
  allocations: readonly CapacityAllocation[];
  window: CapacityWindow;
}): number {
  const window = windowBounds(input.window);
  const availableMs = (window.endMs - window.startMs) * Math.max(1, input.resource.capacity);
  const consumedMs = input.allocations.reduce((total, allocation) => {
    if (!CONSUMING_LIFECYCLES.has(allocation.lifecycle) || !sameResource(input.resource, allocation)) return total;
    const footprint = capacityFootprint(allocation.interval);
    const overlapMs = Math.max(0, Math.min(window.endMs, footprint.endMs) - Math.max(window.startMs, footprint.startMs));
    return total + overlapMs * Math.max(0, allocation.quantity);
  }, 0);
  return Math.round((Math.min(consumedMs, availableMs) / availableMs) * 1_000) / 10;
}
