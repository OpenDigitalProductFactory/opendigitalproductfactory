import { describe, expect, it } from "vitest";
import {
  assembleProductOperatingContext,
  createContextSlice,
  type ProductOperatingContextInput,
} from "./product-operating-context";
import { buildProductDirectionView } from "./product-direction-view";

const requestedAt = new Date("2026-07-28T20:00:00.000Z");
const asOf = new Date("2026-07-28T18:00:00.000Z");

function slice<T extends { id: string; sourceKind: string; asOf: Date }>(
  sourceKind: string,
  items: T[],
) {
  return createContextSlice({ requestedAt, sourceKind, items });
}

function context(
  overrides: Partial<ProductOperatingContextInput> = {},
) {
  return assembleProductOperatingContext({
    requestedAt,
    scope: { kind: "product", id: "product-1" },
    organization: {
      id: "org-1",
      sourceKind: "organization",
      asOf,
      name: "Harbor Salon",
    },
    productLines: [
      {
        id: "line-1",
        sourceKind: "product-line",
        asOf,
        name: "Salon services",
        parentId: null,
      },
    ],
    productLine: {
      id: "line-1",
      sourceKind: "product-line",
      asOf,
      name: "Salon services",
      parentId: null,
    },
    products: [
      {
        id: "product-1",
        productId: "PROD-1",
        productLineId: "line-1",
        sourceKind: "product",
        asOf,
        name: "Hair appointments",
      },
    ],
    enablingDigitalProducts: slice("digital-product", []),
    offerings: slice("product-offering", []),
    catalogItems: slice("catalog-item", []),
    productSold: slice("product-sold", []),
    intelligence: slice("research-proposal", [
      {
        id: "research-1",
        sourceKind: "research-proposal",
        asOf,
        title: "Local booking demand changed",
        scope: "organization",
        digitalProductId: null,
        status: "executed",
      },
    ]),
    demand: slice("backlog-item", [
      {
        id: "BI-READY",
        sourceKind: "backlog-item",
        asOf,
        title: "Extend colour appointments",
        status: "open",
        demandStage: "ready",
        score: 78,
      },
      {
        id: "BI-SHAPED",
        sourceKind: "backlog-item",
        asOf,
        title: "Add express styling",
        status: "open",
        demandStage: "shaped",
        score: null,
      },
    ]),
    decisions: createContextSlice({
      requestedAt,
      sourceKind: "decision-interaction",
      items: [],
      unavailableReason: "No typed business-product decision association exists yet.",
    }),
    objectives: createContextSlice({
      requestedAt,
      sourceKind: "product-objective",
      items: [],
      unavailableReason: "Objectives arrive in Phase 9.",
    }),
    roadmapInputs: slice("epic", []),
    deliveryChanges: slice("change-item", []),
    architecture: slice("ea-element", []),
    scheduledPlaybooks: createContextSlice({
      requestedAt,
      sourceKind: "scheduled-agent-task",
      items: [],
      unavailableReason: "No typed product schedule association exists.",
    }),
    ...overrides,
  });
}

describe("buildProductDirectionView", () => {
  it("leads with real decisions, changes, bets, outcomes, and coworker-run posture in that order", () => {
    const view = buildProductDirectionView(context(), "professional");

    expect(view.sections.map((section) => section.kind)).toEqual([
      "needs-decision",
      "evidence-delta",
      "current-bets",
      "outcome-posture",
      "next-coworker-runs",
    ]);
    expect(view.sections[0]?.items).toEqual([
      expect.objectContaining({
        id: "BI-SHAPED",
        label: "Add express styling",
        sourceKind: "backlog-item",
      }),
    ]);
    expect(view.sections[1]?.items).toEqual([
      expect.objectContaining({
        id: "research-1",
        label: "Local booking demand changed",
      }),
    ]);
    expect(view.sections[2]?.items).toEqual([
      expect.objectContaining({
        id: "BI-READY",
        label: "Extend colour appointments",
      }),
    ]);
    expect(view.sections[3]?.availability).toBe("unavailable");
    expect(view.sections[4]?.availability).toBe("unavailable");
  });

  it("uses guided copy and hides source detail by default without changing evidence", () => {
    const professional = buildProductDirectionView(context(), "professional");
    const guided = buildProductDirectionView(context(), "guided");

    expect(guided.audience).toBe("guided");
    expect(guided.introduction).not.toBe(professional.introduction);
    expect(guided.sections.map((section) => section.items)).toEqual(
      professional.sections.map((section) => section.items),
    );
    expect(guided.evidencePreviewCount).toBe(3);
    expect(professional.evidencePreviewCount).toBe(8);
  });

  it("puts an overdue product outcome in the decision lane and routes the primary action to Outcomes", () => {
    const view = buildProductDirectionView(
      context({
        objectives: slice("product-objective", [
          {
            id: "OBJ-ONE",
            objectiveId: "OBJ-ONE",
            productId: "product-one",
            sourceKind: "product-objective",
            asOf,
            title: "Increase repeat bookings",
            problemStatement: null,
            outcomeHypothesis: "Clearer follow-up will increase repeat bookings.",
            status: "active",
            owner: null,
            measureKind: "percentage",
            measureDefinition: "Visits rebooked within 30 days",
            measureUnit: "%",
            baselineValue: 40,
            targetValue: 60,
            baselineNarrative: null,
            targetNarrative: null,
            reviewCadence: "monthly",
            reviewAt: new Date("2026-07-27T00:00:00.000Z"),
            reviewedAt: null,
            createdAt: asOf,
            updatedAt: asOf,
            observations: [],
            contributingWork: [],
            posture: {
              availability: "insufficient-evidence",
              state: "unknown",
              reason: "observation-missing",
            },
            reviewDue: true,
            postureChanged: false,
          },
        ]),
      }),
      "guided",
    );

    expect(view.sections[0]?.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "OBJ-ONE",
          detail: expect.stringContaining("Outcome review due"),
        }),
      ]),
    );
    expect(view.primaryAction).toEqual({
      label: "Review outcome evidence",
      href: "/portfolio/product/product-1/direction/outcomes",
    });
  });

  it("does not turn missing future contracts into zero-valued facts", () => {
    const view = buildProductDirectionView(context(), "guided");
    const outcomes = view.sections.find(
      (section) => section.kind === "outcome-posture",
    );

    expect(outcomes).toMatchObject({
      availability: "unavailable",
      items: [],
      reason: "Objectives arrive in Phase 9.",
    });
    expect(JSON.stringify(outcomes)).not.toContain('"value":0');
  });
});
