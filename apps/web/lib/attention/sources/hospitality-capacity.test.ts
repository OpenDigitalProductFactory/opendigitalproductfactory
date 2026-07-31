import { describe, expect, it } from "vitest";

import { projectHospitalityCapacityAttention } from "./hospitality-capacity";

const NOW = new Date("2026-07-30T18:00:00.000Z");

const input = {
  archetypeCategory: "food-hospitality",
  blockedResources: [
    {
      id: "resource-1",
      resourceId: "TABLE-ASTER",
      label: "Aster",
      blockedReason: "Loose chair needs repair",
      updatedAt: new Date("2026-07-30T17:00:00.000Z"),
    },
  ],
  quarantinedAllocations: [
    {
      id: "allocation-1",
      allocationId: "HA-1",
      demandType: "booking",
      demandRef: "BK-101",
      startsAt: new Date("2026-07-30T19:00:00.000Z"),
      endsAt: new Date("2026-07-30T20:30:00.000Z"),
      quantity: 1,
      createdAt: new Date("2026-07-30T16:00:00.000Z"),
      resource: { label: "Birch" },
      pool: null,
    },
  ],
  pools: [
    {
      id: "pool-1",
      poolId: "KITCHEN-DINNER",
      label: "Dinner kitchen",
      capacity: 10,
      capacityUnit: "covers",
      intervalMinutes: 30,
      createdAt: new Date("2026-07-01T00:00:00.000Z"),
      updatedAt: new Date("2026-07-30T17:00:00.000Z"),
      allocations: [
        {
          startsAt: new Date("2026-07-30T19:00:00.000Z"),
          endsAt: new Date("2026-07-30T20:00:00.000Z"),
          quantity: 7,
          lifecycle: "reserved",
        },
        {
          startsAt: new Date("2026-07-30T19:30:00.000Z"),
          endsAt: new Date("2026-07-30T20:30:00.000Z"),
          quantity: 6,
          lifecycle: "active",
        },
      ],
    },
    {
      id: "pool-2",
      poolId: "BAKE-AM",
      label: "Morning bake",
      capacity: 4,
      capacityUnit: "batches",
      intervalMinutes: 60,
      createdAt: new Date("2026-07-01T00:00:00.000Z"),
      updatedAt: new Date("2026-07-30T12:00:00.000Z"),
      allocations: [],
    },
  ],
};

describe("projectHospitalityCapacityAttention", () => {
  it("surfaces blocked, quarantined, over-capacity, and idle exceptions", () => {
    const items = projectHospitalityCapacityAttention(input, NOW);

    expect(items.map((item) => item.id)).toEqual(
      expect.arrayContaining([
        "hospitality-capacity:blocked:TABLE-ASTER",
        "hospitality-capacity:quarantined:HA-1",
        "hospitality-capacity:over-capacity:KITCHEN-DINNER",
        "hospitality-capacity:idle:BAKE-AM",
      ]),
    );
    expect(
      items.find((item) => item.id.includes("over-capacity"))?.context,
    ).toContain("13 of 10 covers");
    expect(
      items.find((item) => item.id.includes("quarantined"))?.riskClass,
    ).toBe("high-risk");
    expect(
      items.find((item) => item.id.includes("idle"))?.riskClass,
    ).toBe("read");
    expect(items.every((item) => item.portfolio === "products-and-services-sold"))
      .toBe(true);
  });

  it("is archetype-gated and produces no capacity attention outside Food & Hospitality", () => {
    expect(
      projectHospitalityCapacityAttention(
        { ...input, archetypeCategory: "professional-services" },
        NOW,
      ),
    ).toEqual([]);
  });
});
