import {
  capacityResourceRefKey,
  type CapacityAllocation,
  type CapacityAttentionSignal,
  type CapacityInterval,
  type CapacityResource,
} from "@/lib/capacity/contracts";
import { capacityFootprint, intervalsOverlap } from "@/lib/capacity/intervals";
import type {
  BeautyAllocationFact,
  BeautyBookingFact,
  BeautyCapacityFacts,
  BeautyResourceFact,
} from "./capacity-facts";

const MINUTE_MS = 60_000;
const CONSUMING_LIFECYCLES = new Set(["held", "confirmed", "active"]);

export function beautyResourceRef(resource: BeautyResourceFact) {
  return { authority: "beauty" as const, resourceType: resource.kind, resourceId: resource.id };
}
function ownerTime(date: Date): string {
  return date.toISOString().slice(11, 16);
}

function bookingInterval(booking: BeautyBookingFact): CapacityInterval {
  return {
    startAt: booking.scheduledAt.toISOString(),
    endAt: new Date(booking.scheduledAt.getTime() + booking.durationMinutes * MINUTE_MS).toISOString(),
    preparationMinutes: booking.preparationMinutes,
    cleanupMinutes: booking.cleanupMinutes,
    travelBeforeMinutes: 0,
    travelAfterMinutes: 0,
  };
}

function idleSignal(input: {
  resource: CapacityResource;
  startMs: number;
  minutes: number;
  beforeNextAppointment?: boolean;
  afterLastAppointment?: boolean;
}): CapacityAttentionSignal {
  return {
    signalId: `beauty:idle:${input.resource.ref.resourceId}:${input.startMs}`,
    kind: "idle-capacity",
    authority: "beauty",
    resourceRef: input.resource.ref,
    detail: `${input.resource.label} is open for ${input.minutes} min${
      input.beforeNextAppointment
        ? " before the next appointment"
        : input.afterLastAppointment
          ? " after the last appointment"
          : ""
    }.`,
  };
}

export function beautyAttentionForFacts(input: {
  facts: BeautyCapacityFacts;
  resources: CapacityResource[];
  allocations: CapacityAllocation[];
  windowStart: Date;
  windowEnd: Date;
}): CapacityAttentionSignal[] {
  const signals: CapacityAttentionSignal[] = [];
  const resourceById = new Map(input.facts.resources.map((resource) => [resource.id, resource]));
  const allocationsByDemand = new Map<string, BeautyAllocationFact[]>();
  for (const allocation of input.facts.allocations) {
    const list = allocationsByDemand.get(allocation.demandRef) ?? [];
    list.push(allocation);
    allocationsByDemand.set(allocation.demandRef, list);
  }

  for (const resource of input.facts.resources) {
    if (resource.status !== "active") {
      signals.push({
        signalId: `beauty:blocked:${resource.id}`,
        kind: "blocked-resource",
        authority: "beauty",
        resourceRef: beautyResourceRef(resource),
        detail: `${resource.label} is unavailable${resource.blockedReason ? `: ${resource.blockedReason}` : "."}`,
      });
    }
  }

  for (const booking of input.facts.bookings) {
    const demandAllocations = (allocationsByDemand.get(booking.bookingRef) ?? [])
      .filter((allocation) => CONSUMING_LIFECYCLES.has(allocation.lifecycle));
    if (!booking.providerId || demandAllocations.length === 0) {
      signals.push({
        signalId: `beauty:unassigned:${booking.id}`,
        kind: "unassigned-demand",
        authority: "beauty",
        demandRef: booking.bookingRef,
        detail: `${ownerTime(booking.scheduledAt)} ${booking.customerName} appointment is not fully assigned.`,
      });
    }
    if (demandAllocations.length < booking.requiredResourceCount) {
      signals.push({
        signalId: `beauty:group:${booking.id}`,
        kind: "group-incomplete",
        authority: "beauty",
        demandRef: booking.bookingRef,
        detail: `${ownerTime(booking.scheduledAt)} ${booking.customerName} group is not fully assigned.`,
      });
    }
    for (const allocation of demandAllocations) {
      const resource = resourceById.get(allocation.resourceId);
      if (!resource) continue;
      if (!resource.serviceItemIds.includes(booking.itemId)) {
        signals.push({
          signalId: `beauty:capability:${booking.id}:${resource.id}`,
          kind: "capability-mismatch",
          authority: "beauty",
          resourceRef: beautyResourceRef(resource),
          demandRef: booking.bookingRef,
          detail: `${resource.label} is not configured for this service.`,
        });
      }
      if (resource.status !== "active") {
        signals.push({
          signalId: `beauty:unavailable:${booking.id}:${resource.id}`,
          kind: "unavailable",
          authority: "beauty",
          resourceRef: beautyResourceRef(resource),
          demandRef: booking.bookingRef,
          detail: `${resource.label} is unavailable for the ${ownerTime(booking.scheduledAt)} appointment.`,
        });
      }
    }
    const lowerStatus = booking.status.toLowerCase();
    if (lowerStatus === "no-show-risk" || lowerStatus === "no_show_risk") {
      signals.push({
        signalId: `beauty:no-show:${booking.id}`,
        kind: "no-show-risk",
        authority: "beauty",
        demandRef: booking.bookingRef,
        detail: `${ownerTime(booking.scheduledAt)} ${booking.customerName} appointment has a no-show risk.`,
      });
    }
    if (
      booking.scheduledAt.getTime() + 10 * MINUTE_MS < input.facts.observedAt.getTime() &&
      ["pending", "confirmed", "scheduled"].includes(lowerStatus)
    ) {
      signals.push({
        signalId: `beauty:late:${booking.id}`,
        kind: "late-demand",
        authority: "beauty",
        demandRef: booking.bookingRef,
        detail: `${ownerTime(booking.scheduledAt)} ${booking.customerName} appointment has not started.`,
      });
    }
  }

  const byProvider = new Map<string, BeautyBookingFact[]>();
  for (const booking of input.facts.bookings) {
    if (!booking.providerId) continue;
    const list = byProvider.get(booking.providerId) ?? [];
    list.push(booking);
    byProvider.set(booking.providerId, list);
  }
  for (const bookings of byProvider.values()) {
    const sorted = [...bookings].sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime());
    for (let index = 1; index < sorted.length; index += 1) {
      const previous = sorted[index - 1]!;
      const current = sorted[index]!;
      if (intervalsOverlap(bookingInterval(previous), bookingInterval(current))) {
        signals.push({
          signalId: `beauty:provider-overlap:${previous.id}:${current.id}`,
          kind: "provider-overlap",
          authority: "beauty",
          demandRef: current.bookingRef,
          detail: `${current.providerName ?? "Provider"} is double-booked at ${ownerTime(current.scheduledAt)}.`,
        });
      }
    }
  }

  for (const resource of input.resources) {
    if (resource.status !== "available") continue;
    const resourceAllocations = input.allocations
      .filter((allocation) => capacityResourceRefKey(allocation.resourceRef) === capacityResourceRefKey(resource.ref))
      .filter((allocation) => CONSUMING_LIFECYCLES.has(allocation.lifecycle))
      .sort((a, b) => capacityFootprint(a.interval).startMs - capacityFootprint(b.interval).startMs);
    const configuredWindows = input.facts.availability.filter(
      (window) => window.resourceId === resource.ref.resourceId && window.kind === "available",
    );
    const availableWindows = configuredWindows.length > 0
      ? configuredWindows
      : [{ startsAt: input.windowStart, endsAt: input.windowEnd }];
    const unavailableWindows = input.facts.availability.filter(
      (window) => window.resourceId === resource.ref.resourceId && window.kind === "unavailable",
    );
    for (const available of availableWindows) {
      if (unavailableWindows.some((blocked) =>
        blocked.startsAt < available.endsAt && blocked.endsAt > available.startsAt
      )) continue;
      let cursor = Math.max(input.windowStart.getTime(), available.startsAt.getTime());
      const availableEnd = Math.min(input.windowEnd.getTime(), available.endsAt.getTime());
      let sawAllocation = false;
      for (const allocation of resourceAllocations) {
        const footprint = capacityFootprint(allocation.interval);
        if (footprint.endMs <= cursor || footprint.startMs >= availableEnd) continue;
        sawAllocation = true;
        const gapMinutes = Math.floor((Math.min(footprint.startMs, availableEnd) - cursor) / MINUTE_MS);
        if (gapMinutes >= 30) {
          signals.push(idleSignal({
            resource,
            startMs: cursor,
            minutes: gapMinutes,
            beforeNextAppointment: true,
          }));
        }
        cursor = Math.max(cursor, footprint.endMs);
      }
      const tailMinutes = Math.floor((availableEnd - cursor) / MINUTE_MS);
      if (tailMinutes >= 30) {
        signals.push(idleSignal({
          resource,
          startMs: cursor,
          minutes: tailMinutes,
          afterLastAppointment: sawAllocation,
        }));
      }
    }
  }

  return signals;
}
