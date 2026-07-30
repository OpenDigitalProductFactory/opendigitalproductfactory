import { describe, expect, it } from "vitest";
import {
  createProductRoadmapSnapshot,
  projectProductRoadmap,
  type ProductRoadmapInput,
} from "./product-roadmap";

const NOW = new Date("2026-07-28T12:00:00.000Z");

function input(
  overrides: Partial<ProductRoadmapInput> = {},
): ProductRoadmapInput {
  return {
    requestedAt: NOW,
    scope: { kind: "product", id: "product-1", name: "Guest stays" },
    demand: [
      {
        id: "BI-NOW",
        title: "Faster mobile check-in",
        status: "in-progress",
        demandStage: "ready",
        score: 89,
        investmentBucket: "grow",
        evidenceCount: 3,
        asOf: new Date("2026-07-27T10:00:00.000Z"),
        lastEvidenceChange: {
          kind: "demand_funding_decision",
          summary: "Funding approved after booking evidence review",
          at: new Date("2026-07-27T10:00:00.000Z"),
        },
        delivery: {
          sourceId: "FB-NOW",
          phase: "build",
          asOf: new Date("2026-07-28T08:00:00.000Z"),
          shippedAt: null,
        },
      },
      {
        id: "BI-NEXT",
        title: "Conference room waitlist",
        status: "open",
        demandStage: "ready",
        score: 76,
        investmentBucket: "grow",
        evidenceCount: 2,
        asOf: new Date("2026-07-26T10:00:00.000Z"),
        lastEvidenceChange: null,
        delivery: null,
      },
    ],
    objectives: [
      {
        id: "OBJ-1",
        title: "Increase direct booking completion",
        status: "active",
        workItemIds: ["BI-NOW", "BI-NEXT"],
        asOf: new Date("2026-07-25T10:00:00.000Z"),
      },
    ],
    dependencies: [],
    architectureConstraints: [],
    ...overrides,
  };
}

describe("projectProductRoadmap", () => {
  it("commits only funded work explicitly linked to an active objective", () => {
    const roadmap = projectProductRoadmap(
      input({
        demand: [
          ...input().demand,
          {
            id: "BI-UNCLASSIFIED",
            title: "Legacy request",
            status: "open",
            demandStage: null,
            score: null,
            investmentBucket: null,
            evidenceCount: 0,
            asOf: NOW,
            lastEvidenceChange: null,
            delivery: null,
          },
          {
            id: "BI-UNLINKED",
            title: "Funded but not outcome-linked",
            status: "open",
            demandStage: "ready",
            score: 99,
            investmentBucket: "transform",
            evidenceCount: 4,
            asOf: NOW,
            lastEvidenceChange: null,
            delivery: null,
          },
        ],
      }),
    );

    expect(roadmap.lanes.now.map((item) => item.id)).toEqual(["BI-NOW"]);
    expect(roadmap.lanes.next.map((item) => item.id)).toEqual(["BI-NEXT"]);
    expect(roadmap.readiness).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "BI-UNCLASSIFIED",
          code: "demand-unclassified",
        }),
        expect.objectContaining({
          id: "BI-UNLINKED",
          code: "objective-link-missing",
        }),
      ]),
    );
    expect(roadmap.sourceIds).toContain("BI-UNCLASSIFIED");
  });

  it("fails closed for partial funding, inactive objectives, and contradictory delivery", () => {
    const roadmap = projectProductRoadmap(
      input({
        demand: [
          {
            ...input().demand[0]!,
            id: "BI-SHAPED",
            demandStage: "shaped",
            status: "in-progress",
          },
          {
            ...input().demand[1]!,
            id: "BI-CONTRADICTORY",
            status: "done",
            delivery: {
              sourceId: "FB-CONTRADICTORY",
              phase: "build",
              asOf: NOW,
              shippedAt: null,
            },
          },
        ],
        objectives: [
          {
            id: "OBJ-DRAFT",
            title: "Draft objective",
            status: "draft",
            workItemIds: ["BI-SHAPED", "BI-CONTRADICTORY"],
            asOf: NOW,
          },
        ],
      }),
    );

    expect(roadmap.lanes.now).toEqual([]);
    expect(roadmap.lanes.next).toEqual([]);
    expect(roadmap.lanes.later).toEqual([]);
    expect(roadmap.readiness.map((item) => item.code)).toEqual(
      expect.arrayContaining([
        "funding-not-approved",
        "objective-not-active",
        "delivery-contradiction",
      ]),
    );
  });

  it("detects dependency cycles and blocks every affected committed bet", () => {
    const roadmap = projectProductRoadmap(
      input({
        dependencies: [
          {
            id: "DEP-A-B",
            fromDemandId: "BI-NOW",
            toDemandId: "BI-NEXT",
            status: "active",
            asOf: NOW,
          },
          {
            id: "DEP-B-A",
            fromDemandId: "BI-NEXT",
            toDemandId: "BI-NOW",
            status: "active",
            asOf: NOW,
          },
        ],
      }),
    );

    expect(roadmap.lanes.now.map((item) => item.id)).toEqual(["BI-NOW"]);
    expect(roadmap.lanes.next).toEqual([]);
    expect(roadmap.lanes.later.map((item) => item.id)).toEqual(["BI-NEXT"]);
    expect(
      [...roadmap.lanes.now, ...roadmap.lanes.later].every((item) =>
        item.blockers.some((blocker) => blocker.code === "dependency-cycle"),
      ),
    ).toBe(true);
  });

  it("never invents dates and keeps every alternate view on the same item identities", () => {
    const roadmap = projectProductRoadmap(input());

    expect(roadmap.timeline.map((entry) => entry.itemId)).toEqual([]);
    expect(roadmap.outcomes[0]?.itemIds).toEqual(["BI-NOW", "BI-NEXT"]);
    expect(
      [...roadmap.lanes.now, ...roadmap.lanes.next, ...roadmap.lanes.later]
        .map((item) => item.id)
        .sort(),
    ).toEqual(
      roadmap.outcomes.flatMap((outcome) => outcome.itemIds).sort(),
    );
  });

  it("uses canonical shipped dates and produces a non-importable portable snapshot", () => {
    const roadmap = projectProductRoadmap(
      input({
        demand: [
          {
            ...input().demand[0]!,
            status: "done",
            delivery: {
              sourceId: "PV-1",
              phase: "complete",
              asOf: new Date("2026-07-27T15:00:00.000Z"),
              shippedAt: new Date("2026-07-27T14:00:00.000Z"),
            },
          },
        ],
        objectives: [
          {
            ...input().objectives[0]!,
            workItemIds: ["BI-NOW"],
          },
        ],
      }),
    );
    const snapshot = createProductRoadmapSnapshot(roadmap, {
      view: "timeline",
      audience: "stakeholder",
    });

    expect(roadmap.timeline).toEqual([
      expect.objectContaining({
        itemId: "BI-NOW",
        date: new Date("2026-07-27T14:00:00.000Z"),
        dateKind: "shipped",
        sourceId: "PV-1",
      }),
    ]);
    expect(snapshot).toMatchObject({
      schemaVersion: "dpf.product-roadmap.snapshot.v1",
      importable: false,
      asOf: NOW.toISOString(),
      filters: { view: "timeline", audience: "stakeholder" },
    });
    expect(snapshot.sourceIds).toEqual(
      expect.arrayContaining(["BI-NOW", "OBJ-1", "PV-1"]),
    );
  });
});
