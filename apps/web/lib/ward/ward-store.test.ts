import { describe, expect, it, vi } from "vitest";

import {
  WARD_RESOURCE_DOMAIN,
  buildPlacement,
  buildRelease,
  isInCare,
  loadWardBoard,
  loadWardWorkspace,
  openStayHorizon,
  planSeedKennels,
} from "./ward-store";

const KENNELS = [
  { id: "k1", label: "D1", serviceArea: "Dog ward", capacity: 1, blockedReason: null, lifecycle: "active" },
  { id: "k2", label: "D2", serviceArea: "Dog ward", capacity: 1, blockedReason: null, lifecycle: "active" },
];

function client(over: Record<string, unknown> = {}) {
  return {
    resource: { findMany: vi.fn(async (_args: unknown) => KENNELS) },
    resourceCapacityAllocation: {
      findMany: vi.fn(async (_args: unknown) => [
        { resourceId: "k1", demandRef: "a1", startsAt: new Date("2026-09-01T08:00:00Z"), releasedAt: null },
      ]),
    },
    animalProfile: {
      findMany: vi.fn(async (_args: unknown) => [
        { animalRef: "a1", name: "Ranger", lifecycleStatus: "in_care" },
        { animalRef: "a2", name: "Saffron", lifecycleStatus: "placement_ready" },
      ]),
    },
    ...over,
  };
}

describe("loadWardBoard", () => {
  it("places animals into kennels and leaves the rest unplaced", async () => {
    const board = await loadWardBoard({ organizationId: "org-1", db: client() });

    expect(board?.totalUnits).toBe(2);
    expect(board?.occupied).toBe(1);
    expect(board?.free).toBe(1);
    // Saffron is in care with no kennel recorded.
    expect(board?.unplaced).toEqual([{ animalRef: "a2", name: "Saffron" }]);
  });

  it("reads only this organization's active kennels", async () => {
    const db = client();
    await loadWardBoard({ organizationId: "org-1", db });

    const [firstCall] = db.resource.findMany.mock.calls;
    const where = (firstCall?.[0] as { where: Record<string, unknown> } | undefined)?.where;
    expect(where).toMatchObject({
      organizationId: "org-1",
      kindSlug: { in: ["kennel", "foster-home"] },
      lifecycle: "active",
    });
  });

  it("asks only for open stays — a released one is history, not an occupant", async () => {
    const db = client();
    await loadWardBoard({ organizationId: "org-1", db });

    const [firstCall] = db.resourceCapacityAllocation.findMany.mock.calls;
    const where = (firstCall?.[0] as { where: Record<string, unknown> } | undefined)?.where;
    expect(where).toMatchObject({ demandSlug: "animal-occupancy", releasedAt: null });
  });

  it("distinguishes a shelter with no housing recorded from one with none free", async () => {
    const empty = await loadWardBoard({
      organizationId: "org-1",
      db: client({ resource: { findMany: vi.fn(async (_args: unknown) => []) } }),
    });
    expect(empty).toBeNull();

    const noClient = await loadWardBoard({ organizationId: "org-1", db: {} });
    expect(noClient).toBeNull();
  });

  it("keeps the canonical in-care roster available when no housing is recorded", async () => {
    const db = client({ resource: { findMany: vi.fn(async (_args: unknown) => []) } });

    const workspace = await loadWardWorkspace({ organizationId: "org-1", db });

    expect(workspace.board).toBeNull();
    expect(workspace.animals).toEqual([
      { animalRef: "a1", name: "Ranger" },
      { animalRef: "a2", name: "Saffron" },
    ]);
    const [firstCall] = db.animalProfile.findMany.mock.calls;
    const where = (firstCall?.[0] as { where: Record<string, unknown> } | undefined)?.where;
    expect(where).toEqual({
      organizationId: "org-1",
      lifecycleStatus: { in: ["in_care", "placement_ready"] },
    });
  });

  it("still draws the board when nothing has been placed yet", async () => {
    const board = await loadWardBoard({
      organizationId: "org-1",
      db: client({ resourceCapacityAllocation: { findMany: vi.fn(async (_args: unknown) => []) } }),
    });

    expect(board?.free).toBe(2);
    expect(board?.occupied).toBe(0);
    expect(board?.unplaced.map((row) => row.name).sort()).toEqual(["Ranger", "Saffron"]);
  });
});

describe("isInCare", () => {
  it("counts everything except an animal that has been adopted", () => {
    expect(isInCare("hold")).toBe(true);
    expect(isInCare("available")).toBe(true);
    expect(isInCare("quarantine")).toBe(true);
    expect(isInCare("adopted")).toBe(false);
    expect(isInCare("Adopted")).toBe(false);
  });
});

describe("planSeedKennels", () => {
  const resourceKinds = [{ kindSlug: "kennel", capacityUnit: "animals", maxCapacity: 100 }] as const;

  it("turns the archetype's declared housing into a starting roster", () => {
    const rows = planSeedKennels({
      organizationId: "org-1",
      resourceKinds,
      areas: [
        { serviceArea: "Dog ward", count: 2, labelPrefix: "D" },
        { serviceArea: "Isolation", count: 1, labelPrefix: "I" },
      ],
    });

    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({
      kindSlug: "kennel",
      capacityUnit: "animals",
      capacity: 1,
      domain: WARD_RESOURCE_DOMAIN,
      label: "D1",
      serviceArea: "Dog ward",
    });
    expect(rows.map((row) => row.label)).toEqual(["D1", "D2", "I1"]);
  });

  it("derives a stable key so re-seeding cannot double a roster", () => {
    const once = planSeedKennels({ organizationId: "org-1", resourceKinds, areas: [{ serviceArea: "Dog ward", count: 2, labelPrefix: "D" }] });
    const twice = planSeedKennels({ organizationId: "org-1", resourceKinds, areas: [{ serviceArea: "Dog ward", count: 2, labelPrefix: "D" }] });

    expect(once.map((row) => row.resourceKey)).toEqual(twice.map((row) => row.resourceKey));
    expect(new Set(once.map((row) => row.resourceKey)).size).toBe(2);
  });

  it("seeds nothing for an archetype that does not house its subject", () => {
    expect(
      planSeedKennels({
        organizationId: "org-1",
        resourceKinds: [{ kindSlug: "table", capacityUnit: "seats", maxCapacity: 12 }],
        areas: [{ serviceArea: "Dog ward", count: 4, labelPrefix: "D" }],
      }),
    ).toEqual([]);
  });
});

describe("buildPlacement", () => {
  const now = new Date("2026-09-02T09:00:00Z");

  it("places an animal against the kennel on the canonical allocation", () => {
    expect(buildPlacement({ organizationId: "org-1", kennelId: "k1", animalRef: "a1", now })).toMatchObject({
      domain: WARD_RESOURCE_DOMAIN,
      resourceId: "k1",
      demandSlug: "animal-occupancy",
      demandRef: "a1",
      startsAt: now,
      quantity: 1,
    });
  });

  it("gives an open stay a horizon far enough out that it never reads expired", () => {
    const placement = buildPlacement({ organizationId: "org-1", kennelId: "k1", animalRef: "a1", now });
    expect(placement.endsAt).toEqual(openStayHorizon(now));
    expect(placement.endsAt.getFullYear()).toBe(2036);
  });

  it("makes a repeated place the same move rather than a second animal in the run", () => {
    const a = buildPlacement({ organizationId: "org-1", kennelId: "k1", animalRef: "a1", now });
    const b = buildPlacement({ organizationId: "org-1", kennelId: "k1", animalRef: "a1", now });
    expect(a.idempotencyKey).toBe(b.idempotencyKey);

    const elsewhere = buildPlacement({ organizationId: "org-1", kennelId: "k2", animalRef: "a1", now });
    expect(elsewhere.idempotencyKey).not.toBe(a.idempotencyKey);
  });
});

describe("buildRelease", () => {
  it("closes a stay with its reason rather than deleting the row", () => {
    const now = new Date("2026-09-02T17:00:00Z");
    expect(buildRelease("moved", now)).toEqual({ releasedAt: now, releaseReason: "moved" });
    expect(buildRelease("left-care", now).releaseReason).toBe("left-care");
  });
});
