import type { GeographicSceneZone } from "@dpf/storefront-templates";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { loadServiceAreas, saveServiceAreas, type ServiceAreaDatabase, type ServiceAreaRow } from "./service-area-layout";

const zone: GeographicSceneZone = {
  id: "north",
  label: "North",
  coveredBy: { kind: "staffing-crew", id: "CREW-1" },
  geometry: {
    kind: "polygon",
    rings: [[
      { longitude: -97.9, latitude: 30.1 },
      { longitude: -97.5, latitude: 30.1 },
      { longitude: -97.5, latitude: 30.5 },
      { longitude: -97.9, latitude: 30.1 },
    ]],
  },
};

let row: ServiceAreaRow | null;
type Ops = ServiceAreaDatabase["operationalSceneLayout"];
const db = {
  operationalSceneLayout: {
    findFirst: vi.fn<Ops["findFirst"]>(async () => row),
    create: vi.fn<Ops["create"]>(async () => ({ version: 1 })),
    updateMany: vi.fn<Ops["updateMany"]>(async () => ({ count: 1 })),
  },
};
const database = db as unknown as ServiceAreaDatabase;

beforeEach(() => {
  row = null;
  vi.clearAllMocks();
});

describe("service area layout (AC-COV-DRAW-1, AC-COV-DRAW-2)", () => {
  it("loads no areas at version 0 before the first save", async () => {
    expect(await loadServiceAreas(database, "ORG-1")).toEqual({ version: 0, zones: [] });
  });

  it("creates the TERRITORY layout on first save, centred on the areas", async () => {
    expect(await saveServiceAreas(database, { orgId: "ORG-1", expectedVersion: 0, zones: [zone] })).toEqual({ ok: true, version: 1 });
    const data = db.operationalSceneLayout.create.mock.calls[0]![0]!.data;
    expect(data).toMatchObject({ orgId: "ORG-1", twinTemplate: "TERRITORY", spaceKind: "geographic", locationId: null });
    expect(data.layoutState.zones).toEqual([zone]);
    expect(data.layoutState.viewport.longitude).toBeCloseTo(-97.7);
  });

  it("replaces zones and keeps placements another feature stored", async () => {
    const placement = { id: "p", entityRef: { kind: "depot", id: "d" }, geometry: { kind: "point", longitude: 1, latitude: 1 } };
    row = {
      id: "scene-1",
      version: 3,
      layoutState: { schemaVersion: 1, spaceKind: "geographic", viewport: { latitude: 0, longitude: 0, zoom: 4 }, zones: [], placements: [placement] },
    };
    expect(await saveServiceAreas(database, { orgId: "ORG-1", expectedVersion: 3, zones: [zone] })).toEqual({ ok: true, version: 4 });
    const call = db.operationalSceneLayout.updateMany.mock.calls[0]![0]!;
    expect(call.where).toEqual({ id: "scene-1", orgId: "ORG-1", version: 3 });
    expect(call.data.layoutState.placements).toEqual([placement]);
    expect(call.data.layoutState.zones).toEqual([zone]);
  });

  it("refuses a stale version without writing", async () => {
    row = { id: "scene-1", version: 4, layoutState: { schemaVersion: 1, spaceKind: "geographic", viewport: { latitude: 0, longitude: 0, zoom: 1 }, zones: [], placements: [] } };
    expect(await saveServiceAreas(database, { orgId: "ORG-1", expectedVersion: 3, zones: [] })).toMatchObject({ ok: false, code: "stale" });
    expect(db.operationalSceneLayout.updateMany).not.toHaveBeenCalled();
  });

  it("reports a lost race as stale", async () => {
    row = { id: "scene-1", version: 3, layoutState: { schemaVersion: 1, spaceKind: "geographic", viewport: { latitude: 0, longitude: 0, zoom: 1 }, zones: [], placements: [] } };
    db.operationalSceneLayout.updateMany.mockResolvedValueOnce({ count: 0 });
    expect(await saveServiceAreas(database, { orgId: "ORG-1", expectedVersion: 3, zones: [] })).toMatchObject({ ok: false, code: "stale" });
  });

  it("refuses an invalid area without writing", async () => {
    const open = { ...zone, geometry: { kind: "polygon", rings: [[{ longitude: 0, latitude: 0 }, { longitude: 1, latitude: 0 }]] } };
    expect(await saveServiceAreas(database, { orgId: "ORG-1", expectedVersion: 0, zones: [open] })).toMatchObject({ ok: false, code: "invalid" });
    expect(db.operationalSceneLayout.create).not.toHaveBeenCalled();
  });
});
