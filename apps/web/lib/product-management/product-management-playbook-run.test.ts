import { describe, expect, it, vi } from "vitest";
import {
  completeProductManagementPlaybookRun,
  prepareProductManagementPlaybookRun,
} from "./product-management-playbook-run";
import {
  buildPlaybookPermissionDigest,
  getProductManagementPlaybook,
} from "./product-management-playbook";
import { createContextSlice } from "./product-operating-context";

const now = new Date("2026-07-28T12:00:00Z");
const recipe = getProductManagementPlaybook("roadmap-refresh");
const config = {
  schemaVersion: 1 as const,
  recipeId: recipe.id,
  permissionsDigest: buildPlaybookPermissionDigest(recipe),
  minimumRefreshMinutes: 60,
};

function context() {
  const empty = (sourceKind: string) =>
    createContextSlice({
      requestedAt: now,
      sourceKind,
      items: [],
    });
  return {
    scope: { kind: "product" as const, id: "product-1" },
    requestedAt: now,
    provider: {
      id: "org-1",
      name: "Example",
      sourceKind: "organization",
      asOf: now,
      derivedFromOrganization: true as const,
    },
    productLines: [],
    productLine: null,
    products: [
      {
        id: "product-1",
        name: "Consulting",
        status: "active",
        sourceKind: "business-product",
        asOf: now,
        productLineId: "line-1",
      },
    ],
    enablingDigitalProducts: empty("digital-product"),
    offerings: empty("product-offering"),
    catalogItems: empty("catalog-item"),
    productSold: empty("product-sold"),
    consumers: empty("consumer"),
    commercialPerformance: {
      saleCount: 0,
      additiveRevenue: 0,
      currency: null,
      unallocatedComponentCount: 0,
      availability: "unavailable" as const,
      reason: "No sales.",
    },
    commercialPerformanceByProduct: [],
    intelligence: empty("knowledge-article"),
    demand: createContextSlice({
      requestedAt: now,
      sourceKind: "backlog-item",
      items: [
        {
          id: "BI-1",
          title: "Funded change",
          status: "in-progress",
          sourceKind: "backlog-item",
          asOf: new Date("2026-07-28T11:00:00Z"),
          demandStage: "ready",
          workType: "feature",
          investmentBucket: null,
          effortSize: null,
          score: 80,
          scoreFramework: "rice",
          scoreComputedAt: now,
          readiness: null,
          latestActivityAt: now,
          latestDecision: null,
          activeBuild: null,
        },
      ],
    }),
    decisions: empty("decision-interaction"),
    objectives: empty("product-objective"),
    roadmapInputs: empty("backlog-item"),
    deliveryChanges: empty("change-item"),
    architecture: empty("product-dependency"),
    scheduledPlaybooks: empty("scheduled-agent-task"),
  };
}

describe("prepareProductManagementPlaybookRun", () => {
  it("loads the exact canonical scope and prepares a cited, derived prompt", async () => {
    const loadContext = vi.fn().mockResolvedValue(context());
    const result = await prepareProductManagementPlaybookRun(
      {
        taskId: "agent-task-1",
        organizationId: "org-1",
        productLineId: null,
        businessProductId: "product-1",
        taskConfig: config,
      },
      { loadContext },
    );

    expect(loadContext).toHaveBeenCalledWith({
      organizationId: "org-1",
      scope: { kind: "product", id: "product-1" },
    });
    expect(result.unchanged).toBe(false);
    expect(result.prompt).toContain("Roadmap refresh");
    expect(result.prompt).toContain("BacklogItem remains authoritative");
    expect(result.prompt).toContain("backlog-item:BI-1");
    expect(result.sources).toEqual([
      expect.objectContaining({
        sourceKind: "backlog-item",
        sourceId: "BI-1",
      }),
    ]);
  });

  it("skips model work when the successful source fingerprint is unchanged", async () => {
    const first = await prepareProductManagementPlaybookRun(
      {
        taskId: "agent-task-1",
        organizationId: "org-1",
        productLineId: null,
        businessProductId: "product-1",
        taskConfig: config,
      },
      { loadContext: vi.fn().mockResolvedValue(context()) },
    );
    const second = await prepareProductManagementPlaybookRun(
      {
        taskId: "agent-task-1",
        organizationId: "org-1",
        productLineId: null,
        businessProductId: "product-1",
        taskConfig: {
          ...config,
          lastSuccessfulFingerprint: first.fingerprint,
        },
      },
      { loadContext: vi.fn().mockResolvedValue(context()) },
    );
    expect(second.unchanged).toBe(true);
  });

  it("advances the fingerprint only for a fully successful run", () => {
    expect(
      completeProductManagementPlaybookRun(config, {
        fingerprint: "pm-input-new",
        completedAt: now,
        status: "completed",
      }),
    ).toMatchObject({
      lastSuccessfulFingerprint: "pm-input-new",
    });
    expect(
      completeProductManagementPlaybookRun(config, {
        fingerprint: "pm-input-new",
        completedAt: now,
        status: "partial",
      }),
    ).toMatchObject({
      lastSuccessfulFingerprint: null,
    });
  });
});
