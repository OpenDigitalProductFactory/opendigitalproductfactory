import type { CapacityAdapter } from "@/lib/capacity/adapter-registry";
import type { CapacityAdapterLoadInput } from "@/lib/capacity/adapter-types";
import {
  type CapacityAllocation,
  type CapacityAvailability,
  type CapacityInterval,
  type CapacityResource,
  type CapacityResourceStatus,
} from "@/lib/capacity/contracts";
import { beautyAttentionForFacts, beautyResourceRef } from "./capacity-attention";
import type {
  BeautyCapacityFacts,
  BeautyCapacityFactsLoader,
  BeautyResourceFact,
} from "./capacity-facts";
export type {
  BeautyAllocationFact,
  BeautyAvailabilityFact,
  BeautyBookingFact,
  BeautyCapacityFacts,
  BeautyCapacityFactsLoader,
  BeautyResourceFact,
} from "./capacity-facts";

function interval(input: {
  startsAt: Date;
  endsAt: Date;
  preparationMinutes?: number;
  cleanupMinutes?: number;
}): CapacityInterval {
  return {
    startAt: input.startsAt.toISOString(),
    endAt: input.endsAt.toISOString(),
    preparationMinutes: input.preparationMinutes ?? 0,
    cleanupMinutes: input.cleanupMinutes ?? 0,
    travelBeforeMinutes: 0,
    travelAfterMinutes: 0,
  };
}

function statusFor(resource: BeautyResourceFact): CapacityResourceStatus {
  if (resource.status === "active") return "available";
  if (resource.status === "blocked") return "blocked";
  if (resource.status === "offline" || resource.status === "inactive") return "offline";
  return "unknown";
}

export function projectBeautyCapacityFacts(
  input: CapacityAdapterLoadInput,
  facts: BeautyCapacityFacts,
) {
  const resources: CapacityResource[] = facts.resources.map((resource) => ({
    ref: beautyResourceRef(resource),
    organizationId: resource.organizationId,
    label: resource.label,
    capacity: resource.capacity,
    capacityUnit: resource.capacityUnit,
    status: statusFor(resource),
    ...(resource.serviceArea ? { locationRef: resource.serviceArea } : {}),
    capabilityKeys: resource.serviceItemIds,
    sourceVersion: String(resource.version),
  }));
  const resourceById = new Map(facts.resources.map((resource) => [resource.id, resource]));
  const allocations: CapacityAllocation[] = facts.allocations.flatMap((allocation) => {
    const resource = resourceById.get(allocation.resourceId);
    if (!resource) return [];
    return [{
      allocationId: allocation.allocationId,
      resourceRef: beautyResourceRef(resource),
      demandRef: allocation.demandRef,
      interval: interval({ startsAt: allocation.startsAt, endsAt: allocation.endsAt }),
      quantity: allocation.quantity,
      lifecycle: allocation.lifecycle,
    }];
  });
  const availability: CapacityAvailability[] = facts.availability.flatMap((window) => {
    const resource = resourceById.get(window.resourceId);
    if (!resource) return [];
    return [{
      resourceRef: beautyResourceRef(resource),
      kind: window.kind,
      startAt: window.startsAt.toISOString(),
      endAt: window.endsAt.toISOString(),
      ...(window.reason ? { reason: window.reason } : {}),
    }];
  });

  return {
    authority: "beauty" as const,
    state: "ok" as const,
    resources,
    allocations,
    availability,
    attentionSignals: beautyAttentionForFacts({
      facts,
      resources,
      allocations,
      windowStart: new Date(input.window.startAt),
      windowEnd: new Date(input.window.endAt),
    }),
    watermark: {
      source: "beauty" as const,
      observedAt: facts.observedAt.toISOString(),
      ...(facts.sourceVersion ? { sourceVersion: facts.sourceVersion } : {}),
    },
  };
}

export function createBeautyCapacityAdapter(loadFacts: BeautyCapacityFactsLoader): CapacityAdapter {
  return {
    authority: "beauty",
    async load(input) {
      try {
        return projectBeautyCapacityFacts(input, await loadFacts(input));
      } catch (error) {
        return {
          authority: "beauty",
          state: "degraded",
          resources: [],
          allocations: [],
          availability: [],
          diagnostic: error instanceof Error ? error.message : "Beauty capacity source failed",
        };
      }
    },
  };
}
