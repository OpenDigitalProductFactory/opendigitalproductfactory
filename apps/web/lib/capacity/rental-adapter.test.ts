import { describe, expect, it, vi } from "vitest";
import type { ResourceCapacityProfile } from "@dpf/storefront-templates";
import {
  createRentalCapacityAdapter,
  type RentalAgreementRow,
  type RentalClassRow,
  type RentalStorefrontRow,
  type RentalUnitRow,
} from "./rental-adapter";

const profile: ResourceCapacityProfile = {
  archetypeId: "equipment-rental",
  category: "asset-rental",
  enabled: true,
  patterns: ["rental"],
  authorities: ["rental"],
  resourceNoun: { singular: "asset", plural: "assets" },
  physical: true,
  forwardHorizon: true,
  supportsBuffers: false,
  supportsTravel: false,
};

function dbFixture() {
  const storefronts: RentalStorefrontRow[] = [{ id: "sf-1", organizationId: "org-1" }];
  const classes: RentalClassRow[] = [{
    id: "class-1", storefrontId: "sf-1", name: "Mini excavator",
    bookingConfig: { rentalStockQuantity: 2 },
  }];
  const units: RentalUnitRow[] = [{
    id: "unit-1",
    unitId: "RU-001",
    storefrontId: "sf-1",
    storefrontItemId: "class-1",
    label: "Excavator #1",
    status: "available",
    updatedAt: new Date("2026-08-02T12:00:00.000Z"),
    attributes: {
      rentalPhysical: {
        version: 1,
        kind: "equipment",
        location: { site: "North Yard", zone: "Ready line", position: "Bay 4" },
        readiness: "ready",
        capabilityKeys: ["mini-excavator"],
        maintenanceHold: {
          severity: "hard",
          reason: "Annual inspection",
          startAt: "2026-08-03T08:00:00.000Z",
          endAt: "2026-08-03T12:00:00.000Z",
        },
      },
    },
  }];
  const agreements: RentalAgreementRow[] = [{
    id: "agreement-1",
    agreementRef: "RA-001",
    storefrontId: "sf-1",
    storefrontItemId: "class-1",
    rentableUnitId: "unit-1",
    customerName: "Avery Builder",
    periodStart: new Date("2026-08-02T13:00:00.000Z"),
    periodEnd: new Date("2026-08-02T17:00:00.000Z"),
    status: "active",
    verificationStatus: "verified",
    depositAmount: 500,
    returnConditionId: null,
    overlapQuarantinedAt: null,
    updatedAt: new Date("2026-08-02T12:30:00.000Z"),
  }];
  return {
    storefrontConfig: {
      findMany: vi.fn(async () => storefronts),
    },
    storefrontItem: {
      findMany: vi.fn(async () => classes),
    },
    rentableUnit: {
      findMany: vi.fn(async () => units),
    },
    rentalAgreement: {
      findMany: vi.fn(async () => agreements),
    },
  };
}

describe("rental capacity adapter", () => {
  it("projects physical location, agreement allocation, hard downtime, and watermark", async () => {
    const db = dbFixture();
    const result = await createRentalCapacityAdapter(db, {
      now: () => new Date("2026-08-02T14:00:00.000Z"),
    }).load({
      profile,
      organizationId: "org-1",
      window: { startAt: "2026-08-02T00:00:00.000Z", endAt: "2026-08-04T00:00:00.000Z" },
    });

    expect(db.storefrontConfig.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { organizationId: "org-1" },
    }));
    expect(result.state).toBe("ok");
    expect(result.resources).toContainEqual(expect.objectContaining({
      organizationId: "org-1",
      label: "Excavator #1",
      locationRef: "North Yard / Ready line / Bay 4",
      status: "busy",
      capabilityKeys: expect.arrayContaining(["mini-excavator", "rental-kind:equipment"]),
    }));
    expect(result.allocations).toContainEqual(expect.objectContaining({
      allocationId: "agreement-1",
      demandRef: "RA-001",
      lifecycle: "active",
      quantity: 1,
    }));
    expect(result.availability).toContainEqual(expect.objectContaining({
      kind: "unavailable",
      reason: "Annual inspection",
      startAt: "2026-08-03T08:00:00.000Z",
      endAt: "2026-08-03T12:00:00.000Z",
    }));
    expect(result.watermark).toEqual(expect.objectContaining({
      source: "rental",
      sourceVersion: "2026-08-02T12:30:00.000Z",
    }));
  });

  it("emits overdue, inspection, maintenance, and re-pool attention in rental language", async () => {
    const db = dbFixture();
    db.rentableUnit.findMany.mockResolvedValueOnce([{
      ...(await db.rentableUnit.findMany())[0],
      status: "returned",
      attributes: { rentalPhysical: {
        version: 1,
        kind: "production-kit",
        readiness: "incomplete",
        requiredItemCount: 8,
        readyItemCount: 6,
      } },
    }]);
    db.rentalAgreement.findMany.mockResolvedValueOnce([{
      ...(await db.rentalAgreement.findMany())[0],
      periodEnd: new Date("2026-08-02T13:00:00.000Z"),
      returnConditionId: null,
    }]);

    const result = await createRentalCapacityAdapter(db, {
      now: () => new Date("2026-08-02T14:00:00.000Z"),
    }).load({
      profile: { ...profile, archetypeId: "production-equipment-rental" },
      organizationId: "org-1",
      window: { startAt: "2026-08-02T00:00:00.000Z", endAt: "2026-08-03T00:00:00.000Z" },
    });

    expect(result.attentionSignals).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "overdue-return", demandRef: "RA-001" }),
      expect.objectContaining({ kind: "return-inspection", demandRef: "RA-001" }),
      expect.objectContaining({ kind: "kit-incomplete", resourceRef: expect.objectContaining({ resourceId: "unit-1" }) }),
      expect.objectContaining({ kind: "repool-not-ready", resourceRef: expect.objectContaining({ resourceId: "unit-1" }) }),
    ]));
  });

  it("projects self-storage vacancy, occupancy, access, and waitlist opportunity", async () => {
    const db = dbFixture();
    db.rentableUnit.findMany.mockResolvedValueOnce([{
      ...(await db.rentableUnit.findMany())[0],
      status: "reserved",
      attributes: { rentalPhysical: {
        version: 1,
        kind: "self-storage",
        readiness: "ready",
        location: { site: "Lake Street", zone: "Floor 2", position: "Unit 214" },
        sizeLabel: "10 x 10",
        occupancy: "vacant",
        accessState: "pending",
        waitlistCount: 4,
      } },
    }]);
    db.rentalAgreement.findMany.mockResolvedValueOnce([]);

    const result = await createRentalCapacityAdapter(db).load({
      profile: { ...profile, archetypeId: "self-storage" },
      organizationId: "org-1",
      window: { startAt: "2026-08-02T00:00:00.000Z", endAt: "2026-08-03T00:00:00.000Z" },
    });

    expect(result.resources[0]).toMatchObject({
      ref: { resourceType: "storage-unit" },
      capacityUnit: "storage unit",
      locationRef: "Lake Street / Floor 2 / Unit 214",
    });
    expect(result.attentionSignals).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "occupancy-opportunity" }),
      expect.objectContaining({ kind: "waitlist-demand" }),
      expect.objectContaining({ kind: "access-not-ready" }),
    ]));
  });

  it("returns no cross-organization facts and refuses non-rental profiles", async () => {
    const db = dbFixture();
    db.storefrontConfig.findMany.mockResolvedValueOnce([]);
    const adapter = createRentalCapacityAdapter(db);
    const empty = await adapter.load({
      profile,
      organizationId: "org-foreign",
      window: { startAt: "2026-08-02T00:00:00.000Z", endAt: "2026-08-03T00:00:00.000Z" },
    });
    expect(empty).toMatchObject({ state: "ok", resources: [], allocations: [] });
    expect(db.rentableUnit.findMany).not.toHaveBeenCalled();

    const unsupported = await adapter.load({
      profile: { ...profile, patterns: ["appointment"], authorities: ["provider-calendar"] },
      organizationId: "org-1",
      window: { startAt: "2026-08-02T00:00:00.000Z", endAt: "2026-08-03T00:00:00.000Z" },
    });
    expect(unsupported.state).toBe("unsupported");
  });

  it("projects a 1,000-unit / 10,000-agreement operating window within the hot-path budget", async () => {
    const db = dbFixture();
    const units: RentalUnitRow[] = Array.from({ length: 1_000 }, (_, index) => ({
      id: `unit-${index}`,
      unitId: `RU-${index}`,
      storefrontId: "sf-1",
      storefrontItemId: "class-1",
      label: `Unit ${index}`,
      status: "available",
      attributes: { rentalPhysical: { version: 1, kind: "equipment", readiness: "ready" } },
      updatedAt: new Date("2026-08-02T12:00:00.000Z"),
    }));
    const agreements: RentalAgreementRow[] = Array.from({ length: 10_000 }, (_, index) => ({
      id: `agreement-${index}`,
      agreementRef: `RA-${index}`,
      storefrontId: "sf-1",
      storefrontItemId: "class-1",
      rentableUnitId: `unit-${index % 1_000}`,
      customerName: `Customer ${index}`,
      periodStart: new Date("2026-08-03T13:00:00.000Z"),
      periodEnd: new Date("2026-08-03T17:00:00.000Z"),
      status: "reserved",
      verificationStatus: "verified",
      depositAmount: null,
      returnConditionId: null,
      overlapQuarantinedAt: null,
      updatedAt: new Date("2026-08-02T12:30:00.000Z"),
    }));
    db.rentableUnit.findMany.mockResolvedValueOnce(units);
    db.rentalAgreement.findMany.mockResolvedValueOnce(agreements);

    const startedAt = performance.now();
    const result = await createRentalCapacityAdapter(db, {
      now: () => new Date("2026-08-02T14:00:00.000Z"),
    }).load({
      profile,
      organizationId: "org-1",
      window: { startAt: "2026-08-02T00:00:00.000Z", endAt: "2026-08-05T00:00:00.000Z" },
    });
    const elapsedMs = performance.now() - startedAt;

    expect(result.resources).toHaveLength(1_000);
    expect(result.allocations).toHaveLength(10_000);
    expect(elapsedMs).toBeLessThan(250);
  });
});
