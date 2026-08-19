import { describe, expect, it } from "vitest";
import {
  cloneSourceRef,
  fromBeautyAllocation,
  fromBeautyAvailability,
  fromBeautyResource,
  fromHospitalityAllocation,
  fromHospitalityCapacityPool,
  fromHospitalityResource,
  fromProviderAvailability,
  mapAllocationState,
  mapCloneStatus,
  type CloneAllocationRow,
  type CloneAvailabilityRow,
  type CloneResourceRow,
} from "./clone-adapters";

const resourceRow: CloneResourceRow = {
  id: "br1",
  resourceId: "chair-1",
  organizationId: "org1",
  storefrontId: "sf1",
  kind: "chair",
  label: "Chair 1",
  status: "active",
  capacity: 1,
  capacityUnit: "appointments",
  serviceArea: "floor",
  blockedReason: null,
  attributes: { color: "red" },
  version: 3,
};

describe("cloneSourceRef", () => {
  it("is the <Model>:<id> provenance key", () => {
    expect(cloneSourceRef("BeautyResource", "abc")).toBe("BeautyResource:abc");
  });
});

describe("fromBeautyResource", () => {
  it("maps a clone row losslessly with domain beauty", () => {
    const { draft, warnings } = fromBeautyResource(resourceRow);
    expect(warnings).toEqual([]);
    expect(draft).toMatchObject({
      resourceKey: "chair-1",
      organizationId: "org1",
      storefrontId: "sf1",
      domain: "beauty",
      kindSlug: "chair",
      label: "Chair 1",
      capacity: 1,
      capacityUnit: "appointments",
      sourceRef: "BeautyResource:br1",
      lifecycle: "active",
      lifecycleReason: null,
      version: 3,
    });
  });

  it("preserves unknown legacy status in lifecycleReason with a warning", () => {
    const { draft, warnings } = fromBeautyResource({ ...resourceRow, status: "mothballed" });
    expect(draft.lifecycle).toBe("archived");
    expect(draft.lifecycleReason).toBe("legacy-status:mothballed");
    expect(warnings).toHaveLength(1);
  });
});

describe("fromHospitalityResource", () => {
  it("carries the legacy provider link as subjectRef", () => {
    const { draft } = fromHospitalityResource({
      ...resourceRow,
      legacyServiceProviderId: "sp9",
    });
    expect(draft.domain).toBe("hospitality");
    expect(draft.subjectRef).toBe("ServiceProvider:sp9");
    expect(draft.sourceRef).toBe("HospitalityResource:br1");
  });
});

describe("fromHospitalityCapacityPool", () => {
  it("maps pool identity and cadence", () => {
    const { draft, warnings } = fromHospitalityCapacityPool({
      id: "hp1",
      poolId: "covers",
      organizationId: "org1",
      storefrontId: "sf1",
      kind: "kitchen",
      label: "Kitchen covers",
      capacity: 40,
      capacityUnit: "covers",
      intervalMinutes: 15,
      status: "active",
      attributes: null,
      version: 1,
    });
    expect(warnings).toEqual([]);
    expect(draft).toMatchObject({
      poolKey: "covers",
      domain: "hospitality",
      kindSlug: "kitchen",
      intervalMinutes: 15,
      sourceRef: "HospitalityCapacityPool:hp1",
      lifecycle: "active",
    });
  });
});

const availabilityRow: CloneAvailabilityRow = {
  id: "av1",
  organizationId: "org1",
  kind: "available",
  days: [1, 2, 3],
  startTime: "09:00",
  endTime: "17:00",
  date: null,
  startsAt: null,
  endsAt: null,
  reason: null,
  version: 2,
};

describe("availability adapters", () => {
  it("maps a recurring available window", () => {
    const { draft, warnings } = fromBeautyAvailability(availabilityRow, {
      unifiedResourceId: "res1",
      timezone: "America/Chicago",
    });
    expect(warnings).toEqual([]);
    expect(draft).toMatchObject({
      resourceId: "res1",
      windowKind: "available",
      days: [1, 2, 3],
      timezone: "America/Chicago",
      sourceRef: "BeautyResourceAvailability:av1",
      lifecycle: "active",
    });
  });

  it("records unknown window kinds as blocked with a warning", () => {
    const { draft, warnings } = fromBeautyAvailability(
      { ...availabilityRow, kind: "maintenance" },
      { unifiedResourceId: "res1", timezone: "UTC" },
    );
    expect(draft.windowKind).toBe("blocked");
    expect(warnings).toHaveLength(1);
  });

  it("maps ProviderAvailability (human working time) onto a provider-domain resource", () => {
    const { draft, warnings } = fromProviderAvailability(
      {
        id: "pa1",
        providerId: "sp1",
        days: [5],
        startTime: "10:00",
        endTime: "14:00",
        date: null,
        isBlocked: true,
        reason: "training",
      },
      { unifiedResourceId: "res-provider-1", organizationId: "org1", timezone: "UTC" },
    );
    expect(warnings).toEqual([]);
    expect(draft).toMatchObject({
      resourceId: "res-provider-1",
      windowKind: "blocked",
      reason: "training",
      sourceRef: "ProviderAvailability:pa1",
    });
  });
});

const allocationRow: CloneAllocationRow = {
  id: "al1",
  allocationId: "alloc-1",
  organizationId: "org1",
  storefrontId: "sf1",
  resourceId: "hr1",
  poolId: null,
  bookingId: "bk1",
  bookingHoldId: null,
  demandType: "booking",
  demandRef: "bk1",
  startsAt: new Date(Date.now() + 60 * 60 * 1000),
  endsAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
  quantity: 2,
  lifecycle: "confirmed",
  idempotencyKey: "idem-1",
  releasedAt: null,
  releaseReason: null,
  conflictQuarantinedAt: null,
  version: 1,
};

describe("allocation adapters", () => {
  it("maps clone lifecycle vocabulary onto the state enum", () => {
    expect(mapAllocationState("held")).toBe("held");
    expect(mapAllocationState("reserved")).toBe("reserved");
    expect(mapAllocationState("nonsense")).toBeNull();
  });

  it("maps a confirmed hospitality allocation", () => {
    const { draft, warnings } = fromHospitalityAllocation(allocationRow, {
      unifiedResourceId: "res1",
      unifiedPoolId: null,
    });
    expect(warnings).toEqual([]);
    expect(draft).toMatchObject({
      domain: "hospitality",
      resourceId: "res1",
      poolId: null,
      demandSlug: "booking",
      state: "confirmed",
      lifecycle: "active",
      sourceRef: "HospitalityCapacityAllocation:al1",
    });
  });

  it("folds conflictQuarantinedAt into the W20 lifecycle convention", () => {
    const quarantinedAt = new Date("2026-08-01T00:00:00Z");
    const { draft } = fromHospitalityAllocation(
      { ...allocationRow, conflictQuarantinedAt: quarantinedAt },
      { unifiedResourceId: "res1", unifiedPoolId: null },
    );
    expect(draft.lifecycle).toBe("quarantined");
    expect(draft.lifecycleAt).toBe(quarantinedAt);
    expect(draft.lifecycleReason).toBe("legacy:conflictQuarantinedAt");
    expect(draft.state).toBe("quarantined");
  });

  it("quarantines unmapped legacy states with a warning instead of coercing", () => {
    const { draft, warnings } = fromBeautyAllocation(
      { ...allocationRow, lifecycle: "limbo" },
      { unifiedResourceId: "res1" },
    );
    expect(draft.state).toBe("quarantined");
    expect(draft.lifecycleReason).toBe("legacy-state:limbo");
    expect(warnings).toHaveLength(1);
  });
});

describe("mapCloneStatus", () => {
  it("maps the known vocabulary directly", () => {
    expect(mapCloneStatus("active").lifecycle).toBe("active");
    expect(mapCloneStatus("retired").lifecycle).toBe("retired");
    expect(mapCloneStatus("archived").lifecycle).toBe("archived");
  });
});
