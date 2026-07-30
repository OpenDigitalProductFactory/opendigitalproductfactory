import { describe, expect, it, vi } from "vitest";

import type { CartesianSceneLayout } from "@dpf/storefront-templates";

import {
  saveExistingCartesianScene,
  type OperationalSceneLayoutDatabase,
} from "./operational-scene-layout-repository";

function layout(): CartesianSceneLayout {
  return {
    schemaVersion: 1,
    spaceKind: "cartesian-interior",
    viewport: { x: 0, y: 0, zoom: 1 },
    zones: [],
    placements: [
      {
        id: "table-1",
        label: "Table 1",
        entityRef: { kind: "table", id: "resource-1" },
        geometry: {
          x: 40,
          y: 60,
          width: 72,
          height: 72,
          rotation: 0,
          shapeKind: "round-table",
        },
      },
    ],
  };
}

function database(input?: {
  row?: {
    id: string;
    version: number;
    spaceKind: string;
  } | null;
  updated?: number;
}) {
  return {
    operationalSceneLayout: {
      findFirst: vi.fn().mockResolvedValue(
        input && "row" in input
          ? input.row
          : { id: "scene-1", version: 4, spaceKind: "cartesian-interior" },
      ),
      updateMany: vi.fn().mockResolvedValue({ count: input?.updated ?? 1 }),
    },
  } satisfies OperationalSceneLayoutDatabase;
}

describe("saveExistingCartesianScene", () => {
  it("scopes the update by organization, id, and optimistic version", async () => {
    const db = database();
    const result = await saveExistingCartesianScene({
      database: db,
      organizationOrgId: "org-1",
      sceneId: "scene-1",
      expectedVersion: 4,
      layout: layout(),
    });

    expect(result).toEqual({ ok: true, version: 5 });
    expect(db.operationalSceneLayout.findFirst).toHaveBeenCalledWith({
      where: { id: "scene-1", orgId: "org-1" },
      select: { id: true, version: true, spaceKind: true },
    });
    expect(db.operationalSceneLayout.updateMany).toHaveBeenCalledWith({
      where: { id: "scene-1", orgId: "org-1", version: 4 },
      data: {
        layoutState: layout(),
        underlayRef: null,
        version: { increment: 1 },
      },
    });
  });

  it("does not reveal or update a scene outside the organization", async () => {
    const db = database({ row: null });
    const result = await saveExistingCartesianScene({
      database: db,
      organizationOrgId: "org-2",
      sceneId: "scene-1",
      expectedVersion: 4,
      layout: layout(),
    });

    expect(result).toEqual({
      ok: false,
      code: "not-found",
      error: "This operational layout is no longer available.",
    });
    expect(db.operationalSceneLayout.updateMany).not.toHaveBeenCalled();
  });

  it("returns a conflict instead of overwriting a newer layout", async () => {
    const db = database({
      row: { id: "scene-1", version: 5, spaceKind: "cartesian-interior" },
    });
    const result = await saveExistingCartesianScene({
      database: db,
      organizationOrgId: "org-1",
      sceneId: "scene-1",
      expectedVersion: 4,
      layout: layout(),
    });

    expect(result).toEqual({
      ok: false,
      code: "conflict",
      error:
        "This layout changed in another session. Refresh before moving more resources.",
    });
    expect(db.operationalSceneLayout.updateMany).not.toHaveBeenCalled();
  });

  it("treats a lost update race as a conflict", async () => {
    const db = database({ updated: 0 });
    const result = await saveExistingCartesianScene({
      database: db,
      organizationOrgId: "org-1",
      sceneId: "scene-1",
      expectedVersion: 4,
      layout: layout(),
    });

    expect(result).toMatchObject({ ok: false, code: "conflict" });
  });

  it("rejects invalid versions, coordinate spaces, and scene payloads before writing", async () => {
    const db = database();
    const invalidVersion = await saveExistingCartesianScene({
      database: db,
      organizationOrgId: "org-1",
      sceneId: "scene-1",
      expectedVersion: 0,
      layout: layout(),
    });
    expect(invalidVersion).toMatchObject({ ok: false, code: "invalid" });

    const invalidLayout = await saveExistingCartesianScene({
      database: db,
      organizationOrgId: "org-1",
      sceneId: "scene-1",
      expectedVersion: 4,
      layout: {
        ...layout(),
        placements: [
          {
            ...layout().placements[0]!,
            geometry: {
              ...layout().placements[0]!.geometry,
              width: -1,
            },
          },
        ],
      },
    });
    expect(invalidLayout).toEqual({
      ok: false,
      code: "invalid",
      error: "Placement table-1 has invalid geometry.",
    });

    const wrongKindDb = database({
      row: { id: "scene-1", version: 4, spaceKind: "geographic" },
    });
    const wrongKind = await saveExistingCartesianScene({
      database: wrongKindDb,
      organizationOrgId: "org-1",
      sceneId: "scene-1",
      expectedVersion: 4,
      layout: layout(),
    });
    expect(wrongKind).toEqual({
      ok: false,
      code: "invalid",
      error: "This saved layout does not use cartesian coordinates.",
    });

    expect(db.operationalSceneLayout.updateMany).not.toHaveBeenCalled();
    expect(wrongKindDb.operationalSceneLayout.updateMany).not.toHaveBeenCalled();
  });
});
