import { describe, expect, it, vi } from "vitest";

import type { OperationalSceneLayoutDatabase } from "./restaurant-scene-layout";
import {
  buildRestaurantStarterScene,
  loadOrCreateRestaurantScene,
} from "./restaurant-scene-layout";

const TABLES = [
  {
    id: "table-1",
    label: "Aster",
    capacity: 4,
    serviceArea: "Main dining",
    attributes: { shape: "round" },
  },
  {
    id: "table-2",
    label: "Booth-shaped name that must not drive layout",
    capacity: 6,
    serviceArea: "Main dining",
    attributes: { shape: "rectangle" },
  },
  {
    id: "table-3",
    label: "Patio 1",
    capacity: 2,
    serviceArea: "Patio",
    attributes: { shape: "square" },
  },
];

function database(
  existing: {
    id: string;
    version: number;
    layoutState: unknown;
  } | null = null,
) {
  return {
    operationalSceneLayout: {
      findUnique: vi.fn(async () => existing),
      create: vi.fn(async ({ data }) => ({
        id: "scene-1",
        version: 1,
        layoutState: data.layoutState,
      })),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
  } satisfies OperationalSceneLayoutDatabase;
}

describe("buildRestaurantStarterScene", () => {
  it("uses structured service areas and shapes, never label heuristics", () => {
    const scene = buildRestaurantStarterScene(TABLES);

    expect(scene.zones.map((zone) => zone.label)).toEqual([
      "Main dining",
      "Patio",
    ]);
    expect(
      scene.placements.map((placement) => [
        placement.entityRef.id,
        placement.geometry.shapeKind,
      ]),
    ).toEqual([
      ["table-1", "round-table"],
      ["table-2", "rectangle-table"],
      ["table-3", "square-table"],
    ]);
  });

  it("is deterministic and keeps every placement inside its service area", () => {
    const first = buildRestaurantStarterScene(TABLES);
    const second = buildRestaurantStarterScene([...TABLES].reverse());

    expect(second).toEqual(first);
    for (const placement of first.placements) {
      const zone = first.zones.find(
        (candidate) =>
          candidate.label ===
          TABLES.find((table) => table.id === placement.entityRef.id)?.serviceArea,
      );
      expect(zone?.geometry.kind).toBe("rectangle");
      if (zone?.geometry.kind !== "rectangle") continue;
      expect(placement.geometry.x).toBeGreaterThanOrEqual(zone.geometry.x);
      expect(placement.geometry.y).toBeGreaterThanOrEqual(zone.geometry.y);
      expect(placement.geometry.x + placement.geometry.width).toBeLessThanOrEqual(
        zone.geometry.x + zone.geometry.width,
      );
      expect(
        placement.geometry.y + placement.geometry.height,
      ).toBeLessThanOrEqual(zone.geometry.y + zone.geometry.height);
    }
  });

  it("lays out a dining room as a recognizable primary room with adjacent areas", () => {
    const scene = buildRestaurantStarterScene([
      ...TABLES,
      {
        id: "table-4",
        label: "Aster 2",
        capacity: 4,
        serviceArea: "Main dining",
        attributes: { shape: "round" },
      },
    ]);
    const main = scene.zones.find((zone) => zone.label === "Main dining");
    const patio = scene.zones.find((zone) => zone.label === "Patio");

    expect(main?.geometry.kind).toBe("rectangle");
    expect(patio?.geometry.kind).toBe("rectangle");
    if (main?.geometry.kind !== "rectangle" || patio?.geometry.kind !== "rectangle") {
      return;
    }
    expect(main.geometry.x).toBe(0);
    expect(main.geometry.y).toBe(0);
    expect(patio.geometry.x).toBeGreaterThan(main.geometry.x + main.geometry.width);
    expect(scene.viewport.zoom).toBeLessThanOrEqual(0.8);
  });
});

describe("loadOrCreateRestaurantScene", () => {
  it("creates one location-scoped FLOOR scene from structured tables", async () => {
    const db = database();
    const scene = await loadOrCreateRestaurantScene({
      database: db,
      orgId: "ORG-1",
      locationId: "storefront-1",
      locationLabel: "Restaurant floor",
      tables: TABLES,
    });

    expect(db.operationalSceneLayout.findUnique).toHaveBeenCalledWith({
      where: {
        orgId_twinTemplate_locationId: {
          orgId: "ORG-1",
          twinTemplate: "FLOOR",
          locationId: "storefront-1",
        },
      },
      select: { id: true, version: true, layoutState: true },
    });
    expect(db.operationalSceneLayout.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        orgId: "ORG-1",
        twinTemplate: "FLOOR",
        spaceKind: "cartesian-interior",
        locationId: "storefront-1",
        label: "Restaurant floor",
      }),
      select: { id: true, version: true, layoutState: true },
    });
    expect(scene).toMatchObject({
      id: "scene-1",
      version: 1,
      createdFromStarter: true,
    });
  });

  it("returns the authored scene unchanged when it already exists", async () => {
    const starter = buildRestaurantStarterScene(TABLES);
    const authored = {
      ...starter,
      placements: starter.placements.map((placement, index) =>
        index === 0
          ? {
              ...placement,
              geometry: { ...placement.geometry, x: 777 },
            }
          : placement,
      ),
    };
    const db = database({
      id: "scene-existing",
      version: 5,
      layoutState: authored,
    });

    const scene = await loadOrCreateRestaurantScene({
      database: db,
      orgId: "ORG-1",
      locationId: "storefront-1",
      locationLabel: "Restaurant floor",
      tables: TABLES,
    });

    expect(scene.layout.placements[0]?.geometry.x).toBe(777);
    expect(scene.createdFromStarter).toBe(false);
    expect(db.operationalSceneLayout.create).not.toHaveBeenCalled();
  });

  it("preserves authored positions while version-saving newly added tables", async () => {
    const starter = buildRestaurantStarterScene(TABLES.slice(0, 1));
    const authored = {
      ...starter,
      placements: starter.placements.map((placement) => ({
        ...placement,
        geometry: { ...placement.geometry, x: 777 },
      })),
    };
    const db = database({
      id: "scene-existing",
      version: 5,
      layoutState: authored,
    });

    const scene = await loadOrCreateRestaurantScene({
      database: db,
      orgId: "ORG-1",
      locationId: "storefront-1",
      locationLabel: "Restaurant floor",
      tables: TABLES.slice(0, 2),
    });

    expect(scene.version).toBe(6);
    expect(scene.layout.placements.find(
      (placement) => placement.entityRef.id === "table-1",
    )?.geometry.x).toBe(777);
    expect(scene.layout.placements.some(
      (placement) => placement.entityRef.id === "table-2",
    )).toBe(true);
    expect(db.operationalSceneLayout.updateMany).toHaveBeenCalledWith({
      where: { id: "scene-existing", version: 5 },
      data: {
        layoutState: expect.any(Object),
        underlayRef: null,
        version: { increment: 1 },
      },
    });
  });

  it("replaces only the legacy unassigned starter after structured areas arrive", async () => {
    const unassigned = buildRestaurantStarterScene(
      TABLES.map((table) => ({ ...table, serviceArea: null })),
    );
    const db = database({
      id: "scene-existing",
      version: 5,
      layoutState: unassigned,
    });

    const scene = await loadOrCreateRestaurantScene({
      database: db,
      orgId: "ORG-1",
      locationId: "storefront-1",
      locationLabel: "Restaurant floor",
      tables: TABLES,
    });

    expect(scene.version).toBe(6);
    expect(scene.layout.zones.map((zone) => zone.label)).toEqual([
      "Main dining",
      "Patio",
    ]);
    expect(db.operationalSceneLayout.updateMany).toHaveBeenCalledWith({
      where: { id: "scene-existing", version: 5 },
      data: {
        layoutState: scene.layout,
        underlayRef: null,
        version: { increment: 1 },
      },
    });
  });

  it("fails honestly when the persisted layout is invalid", async () => {
    const db = database({
      id: "scene-existing",
      version: 5,
      layoutState: { schemaVersion: 0 },
    });

    await expect(
      loadOrCreateRestaurantScene({
        database: db,
        orgId: "ORG-1",
        locationId: "storefront-1",
        locationLabel: "Restaurant floor",
        tables: TABLES,
      }),
    ).rejects.toThrow("saved restaurant floor layout is invalid");
    expect(db.operationalSceneLayout.create).not.toHaveBeenCalled();
  });

  it("returns the winning row when two first-load requests race", async () => {
    const winner = {
      id: "scene-winner",
      version: 1,
      layoutState: buildRestaurantStarterScene(TABLES),
    };
    const findUnique = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(winner);
    const db = {
      operationalSceneLayout: {
        findUnique,
        create: vi.fn(async () => {
          throw { code: "P2002" };
        }),
        updateMany: vi.fn(async () => ({ count: 1 })),
      },
    } satisfies OperationalSceneLayoutDatabase;

    const scene = await loadOrCreateRestaurantScene({
      database: db,
      orgId: "ORG-1",
      locationId: "storefront-1",
      locationLabel: "Restaurant floor",
      tables: TABLES,
    });

    expect(scene.id).toBe("scene-winner");
    expect(scene.createdFromStarter).toBe(false);
    expect(findUnique).toHaveBeenCalledTimes(2);
  });
});
