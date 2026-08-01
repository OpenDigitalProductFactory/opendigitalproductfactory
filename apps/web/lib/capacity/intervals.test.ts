import { describe, expect, it } from "vitest";
import type { CapacityAllocation, CapacityInterval, CapacityResource } from "./contracts";
import {
  capacityConflictsToAttentionSignals,
  capacityFootprint,
  evaluateCapacityDemand,
  intervalsOverlap,
  utilizationPercent,
} from "./intervals";

const resource: CapacityResource = {
  ref: { authority: "provider-calendar", resourceType: "chair", resourceId: "chair-1" },
  organizationId: "org-1",
  label: "Chair 1",
  capacity: 1,
  capacityUnit: "appointments",
  status: "available",
  capabilityKeys: ["hair-colour"],
};

const interval = (startAt: string, endAt: string, extra: Partial<CapacityInterval> = {}): CapacityInterval => ({
  startAt,
  endAt,
  preparationMinutes: 0,
  cleanupMinutes: 0,
  travelBeforeMinutes: 0,
  travelAfterMinutes: 0,
  ...extra,
});

const allocation = (overrides: Partial<CapacityAllocation> = {}): CapacityAllocation => ({
  allocationId: "allocation-1",
  resourceRef: resource.ref,
  demandRef: "booking-1",
  interval: interval("2026-08-01T14:00:00.000Z", "2026-08-01T15:00:00.000Z"),
  quantity: 1,
  lifecycle: "confirmed",
  ...overrides,
});

describe("capacity interval semantics", () => {
  it("expands the effective footprint by travel, preparation, and cleanup", () => {
    const footprint = capacityFootprint(interval(
      "2026-08-01T14:00:00.000Z",
      "2026-08-01T15:00:00.000Z",
      { travelBeforeMinutes: 20, preparationMinutes: 10, cleanupMinutes: 15, travelAfterMinutes: 25 },
    ));

    expect(new Date(footprint.startMs).toISOString()).toBe("2026-08-01T13:30:00.000Z");
    expect(new Date(footprint.endMs).toISOString()).toBe("2026-08-01T15:40:00.000Z");
  });

  it("uses half-open intervals so adjacent work does not conflict", () => {
    expect(intervalsOverlap(
      interval("2026-08-01T14:00:00.000Z", "2026-08-01T15:00:00.000Z"),
      interval("2026-08-01T15:00:00.000Z", "2026-08-01T16:00:00.000Z"),
    )).toBe(false);
  });

  it("detects capacity, capability, availability, and travel-window conflicts", () => {
    const conflicts = evaluateCapacityDemand({
      resource: { ...resource, status: "blocked" },
      allocations: [allocation()],
      demand: {
        demandRef: "booking-2",
        resourceRef: resource.ref,
        interval: interval("2026-08-01T14:30:00.000Z", "2026-08-01T15:30:00.000Z", { travelBeforeMinutes: 20 }),
        quantity: 1,
        requiredCapabilityKeys: ["balayage"],
        availableTravelMinutes: 10,
      },
    });

    expect(conflicts.map((item) => item.kind)).toEqual(expect.arrayContaining([
      "unavailable",
      "capability-mismatch",
      "travel-window",
      "time-overlap",
      "capacity-exceeded",
    ]));
    expect(capacityConflictsToAttentionSignals(conflicts)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "capacity-exceeded",
          authority: "provider-calendar",
          demandRef: "booking-2",
        }),
      ]),
    );
  });

  it("does not consume released or cancelled allocations", () => {
    const conflicts = evaluateCapacityDemand({
      resource,
      allocations: [allocation({ lifecycle: "released" }), allocation({ lifecycle: "cancelled", allocationId: "allocation-2" })],
      demand: {
        demandRef: "booking-2",
        resourceRef: resource.ref,
        interval: interval("2026-08-01T14:30:00.000Z", "2026-08-01T15:30:00.000Z"),
        quantity: 1,
        requiredCapabilityKeys: [],
      },
    });

    expect(conflicts).toEqual([]);
  });

  it("calculates bounded utilization over the requested window", () => {
    expect(utilizationPercent({
      resource,
      allocations: [allocation()],
      window: interval("2026-08-01T13:00:00.000Z", "2026-08-01T17:00:00.000Z"),
    })).toBe(25);
  });
});
