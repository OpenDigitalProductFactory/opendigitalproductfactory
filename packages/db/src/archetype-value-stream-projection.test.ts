import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OperationalValueStream } from "@dpf/storefront-templates";

// The service imports the package Prisma singleton at module load; stub it so
// the test never touches the generated client (we always inject a mock `db`).
vi.mock("./client.js", () => ({ prisma: {} }));

import {
  projectArchetypeValueStream,
  type ProjectArchetypeValueStreamInput,
} from "./archetype-value-stream-projection.js";

// A small, explicit OVSM (3 primary stages) keeps mock wiring focused on the
// projection behaviour rather than the full 8-stage backbone.
const OVSM: OperationalValueStream = {
  archetypeId: "hair-salon",
  archetypeName: "Hair Salon",
  category: "beauty-personal-care",
  capacityUnit: "slot-hours",
  demandSignature: "weekly",
  trustGates: [],
  it4itStageBinding: ["request-to-fulfill"],
  loadBearingStageKeys: ["qualify"],
  stages: [
    { key: "capture", label: "Capture Demand", order: 20, loadBearing: false, capabilityBindings: [], metricBindings: ["inbox-submissions"], trustGateKeys: [] },
    { key: "qualify", label: "Qualify & Schedule", order: 30, loadBearing: true, capabilityBindings: ["service-operations"], metricBindings: ["utilization"], trustGateKeys: [] },
    { key: "settle", label: "Settle & Account", order: 50, loadBearing: false, capabilityBindings: ["billing-readiness"], metricBindings: ["invoice"], trustGateKeys: [] },
  ],
};

function makeDb() {
  return {
    eaNotation: { findUnique: vi.fn().mockResolvedValue({ id: "notation-1" }) },
    viewpointDefinition: { findUnique: vi.fn().mockResolvedValue({ id: "viewpoint-1" }) },
    eaElementType: {
      findUnique: vi.fn(async (args: { where: { notationId_slug: { slug: string } } }) => ({
        id: `type-${args.where.notationId_slug.slug}`,
      })),
    },
    eaRelationshipType: { findUnique: vi.fn().mockResolvedValue({ id: "reltype-flow" }) },
    eaView: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    eaElement: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), findMany: vi.fn(), deleteMany: vi.fn() },
    eaViewElement: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), deleteMany: vi.fn() },
    eaRelationship: { findFirst: vi.fn(), create: vi.fn(), deleteMany: vi.fn() },
  };
}

type MockDb = ReturnType<typeof makeDb>;

function run(db: MockDb, orgId = "org-1") {
  return projectArchetypeValueStream({
    db: db as unknown as ProjectArchetypeValueStreamInput["db"],
    orgId,
    ovsm: OVSM,
  });
}

describe("projectArchetypeValueStream", () => {
  let db: MockDb;

  beforeEach(() => {
    db = makeDb();
  });

  it("creates the org operational value-stream view, band, stages, and flows", async () => {
    db.eaView.findFirst.mockResolvedValue(null);
    db.eaView.create.mockResolvedValue({ id: "view-1" });
    db.eaElement.findMany.mockResolvedValue([]); // no prior projection
    db.eaElement.findFirst.mockResolvedValue(null);
    db.eaElement.create
      .mockResolvedValueOnce({ id: "ea-band" })
      .mockResolvedValueOnce({ id: "ea-capture" })
      .mockResolvedValueOnce({ id: "ea-qualify" })
      .mockResolvedValueOnce({ id: "ea-settle" });
    db.eaViewElement.findUnique.mockResolvedValue(null);
    db.eaViewElement.create
      .mockResolvedValueOnce({ id: "ve-band" })
      .mockResolvedValueOnce({ id: "ve-capture" })
      .mockResolvedValueOnce({ id: "ve-qualify" })
      .mockResolvedValueOnce({ id: "ve-settle" });
    db.eaRelationship.findFirst.mockResolvedValue(null);
    db.eaRelationship.create.mockResolvedValue({ id: "rel" });

    const result = await run(db);

    expect(result).toMatchObject({
      viewId: "view-1",
      createdView: true,
      createdElements: 4, // 1 band + 3 stages
      createdViewElements: 4,
      removedElements: 0,
    });

    // View carries the org-scoped operational scope.
    expect(db.eaView.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          scopeType: "archetype_value_stream",
          scopeRef: "org-1:operational",
          layoutType: "graph",
        }),
      }),
    );

    // Band element is a stream_band.
    expect(db.eaElement.create).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        data: expect.objectContaining({
          properties: expect.objectContaining({
            projection: expect.objectContaining({ layoutRole: "stream_band", source: "archetype-ovsm", orgId: "org-1" }),
          }),
        }),
      }),
    );

    // First stage element is a stream_stage carrying OVSM metadata.
    const stageCall = db.eaElement.create.mock.calls[1]![0] as { data: { properties: { projection: Record<string, unknown>; operationalValueStream: Record<string, unknown> } } };
    expect(stageCall.data.properties.projection.layoutRole).toBe("stream_stage");
    expect(stageCall.data.properties.projection.stageKey).toBe("capture");
    expect(stageCall.data.properties.operationalValueStream.capacityUnit).toBe("slot-hours");

    // The load-bearing stage (qualify) is flagged.
    const qualifyCall = db.eaElement.create.mock.calls[2]![0] as { data: { properties: { operationalValueStream: { loadBearing: boolean; stageKey: string } } } };
    expect(qualifyCall.data.properties.operationalValueStream.stageKey).toBe("qualify");
    expect(qualifyCall.data.properties.operationalValueStream.loadBearing).toBe(true);

    // Stage view elements hang off the band, in order.
    expect(db.eaViewElement.create).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ data: expect.objectContaining({ parentViewElementId: "ve-band", orderIndex: 0 }) }),
    );

    // Two flows: capture → qualify → settle.
    expect(db.eaRelationship.create).toHaveBeenCalledTimes(2);
    expect(db.eaElement.deleteMany).not.toHaveBeenCalled();
  });

  it("refreshes an existing projection in place without creating duplicates", async () => {
    db.eaView.findFirst.mockResolvedValue({ id: "view-1" });
    db.eaView.update.mockResolvedValue({ id: "view-1" });
    db.eaElement.findMany.mockResolvedValue([
      { id: "ea-band" },
      { id: "ea-capture" },
      { id: "ea-qualify" },
      { id: "ea-settle" },
    ]);
    db.eaElement.findFirst
      .mockResolvedValueOnce({ id: "ea-band" })
      .mockResolvedValueOnce({ id: "ea-capture" })
      .mockResolvedValueOnce({ id: "ea-qualify" })
      .mockResolvedValueOnce({ id: "ea-settle" });
    db.eaElement.update.mockImplementation(async (args: { where: { id: string } }) => ({ id: args.where.id }));
    db.eaViewElement.findUnique
      .mockResolvedValueOnce({ id: "ve-band" })
      .mockResolvedValueOnce({ id: "ve-capture" })
      .mockResolvedValueOnce({ id: "ve-qualify" })
      .mockResolvedValueOnce({ id: "ve-settle" });
    db.eaViewElement.update.mockImplementation(async (args: { where: { id: string } }) => ({ id: args.where.id }));
    db.eaRelationship.findFirst.mockResolvedValue({ id: "rel" });

    const result = await run(db);

    expect(result).toMatchObject({
      viewId: "view-1",
      createdView: false,
      createdElements: 0,
      updatedElements: 4,
      createdViewElements: 0,
      updatedViewElements: 4,
      removedElements: 0,
    });
    expect(db.eaView.create).not.toHaveBeenCalled();
    expect(db.eaElement.create).not.toHaveBeenCalled();
    expect(db.eaViewElement.create).not.toHaveBeenCalled();
    expect(db.eaRelationship.create).not.toHaveBeenCalled();
  });

  it("prunes orphan stages left by an archetype change (e.g. dropped Return & Inspect)", async () => {
    db.eaView.findFirst.mockResolvedValue({ id: "view-1" });
    db.eaView.update.mockResolvedValue({ id: "view-1" });
    // A prior rental projection left an extra return-inspect element.
    db.eaElement.findMany.mockResolvedValue([
      { id: "ea-band" },
      { id: "ea-capture" },
      { id: "ea-qualify" },
      { id: "ea-settle" },
      { id: "ea-return-inspect" }, // orphan: not in the current OVSM
    ]);
    db.eaElement.findFirst
      .mockResolvedValueOnce({ id: "ea-band" })
      .mockResolvedValueOnce({ id: "ea-capture" })
      .mockResolvedValueOnce({ id: "ea-qualify" })
      .mockResolvedValueOnce({ id: "ea-settle" });
    db.eaElement.update.mockImplementation(async (args: { where: { id: string } }) => ({ id: args.where.id }));
    db.eaViewElement.findUnique
      .mockResolvedValueOnce({ id: "ve-band" })
      .mockResolvedValueOnce({ id: "ve-capture" })
      .mockResolvedValueOnce({ id: "ve-qualify" })
      .mockResolvedValueOnce({ id: "ve-settle" });
    db.eaViewElement.update.mockImplementation(async (args: { where: { id: string } }) => ({ id: args.where.id }));
    db.eaRelationship.findFirst.mockResolvedValue({ id: "rel" });
    db.eaRelationship.deleteMany.mockResolvedValue({ count: 0 });
    db.eaViewElement.deleteMany.mockResolvedValue({ count: 1 });
    db.eaElement.deleteMany.mockResolvedValue({ count: 1 });

    const result = await run(db);

    expect(result.removedElements).toBe(1);
    expect(db.eaElement.deleteMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: { in: ["ea-return-inspect"] } }) }),
    );
    expect(db.eaRelationship.deleteMany).toHaveBeenCalled();
  });

  it("throws clearly when ArchiMate notation is not seeded", async () => {
    db.eaNotation.findUnique.mockResolvedValue(null);
    await expect(run(db)).rejects.toThrow("ArchiMate 4 notation is not seeded");
  });
});
