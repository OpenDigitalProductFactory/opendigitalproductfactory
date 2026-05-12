import { beforeEach, describe, expect, it, vi } from "vitest";

const backlogFindManyMock = vi.fn();
const taskRunFindManyMock = vi.fn();

vi.mock("@dpf/db", () => ({
  prisma: {
    backlogItem: {
      findMany: backlogFindManyMock,
    },
    taskRun: {
      findMany: taskRunFindManyMock,
    },
  },
}));

vi.mock("./finance-signals", () => ({
  getCapacityProviderFinanceSignals: vi.fn().mockResolvedValue([
    {
      providerId: "openai",
      providerClass: "fixed-cost",
      status: "active",
      utilizationPct: 40,
      projectedUnusedValue: 100,
      overageRisk: false,
    },
  ]),
}));

vi.mock("@/lib/tak/agent-grants", () => ({
  getToolGrantMapping: vi.fn().mockReturnValue({
    list_backlog_items: ["backlog_read"],
    deploy_release: ["release_gate_create"],
  }),
}));

describe("selectBacklogReviewCapacityCandidates", () => {
  beforeEach(() => {
    backlogFindManyMock.mockReset();
    taskRunFindManyMock.mockReset();
  });

  it("builds read-only backlog review candidates enriched with finance routing hints", async () => {
    taskRunFindManyMock.mockResolvedValue([]);
    backlogFindManyMock.mockResolvedValue([
      {
        id: "internal-1",
        itemId: "BI-123",
        title: "Clarify stale AI operations spec",
        body: "Review the spec and identify drift against runtime.",
        priority: 1,
        updatedAt: new Date("2026-05-01T00:00:00.000Z"),
        epic: { epicId: "EP-AI", title: "AI operations" },
      },
    ]);

    const { selectBacklogReviewCapacityCandidates } = await import("./backlog-selector");

    await expect(
      selectBacklogReviewCapacityCandidates({
        agentId: "agent-capacity",
        ownerPrincipalId: "principal-owner",
        capacityWindowId: "window-1",
        limit: 2,
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        candidateId: "backlog-review:BI-123",
        dedupeKey: "capacity:backlog-review:BI-123",
        source: "backlog",
        title: "Review backlog item BI-123: Clarify stale AI operations spec",
        routeContext: "/workspace/my-queue",
        agentId: "agent-capacity",
        ownerPrincipalId: "principal-owner",
        riskClass: "read-only",
        sourceRef: { kind: "backlog-item", id: "BI-123" },
        capacityWindowId: "window-1",
        routingHints: expect.objectContaining({
          budgetClass: "minimize_cost",
          preferredProviderClass: "fixed-cost",
          reasonCodes: ["underused_commitment", "safe_background_work"],
        }),
        financeTracking: expect.objectContaining({
          observedProviderClasses: ["fixed-cost"],
          sourceProviderIds: ["openai"],
          projectedUnusedValue: 100,
          utilizationPct: 40,
        }),
      }),
    ]);
  });

  it("skips backlog items with recent capacity dedupe keys", async () => {
    taskRunFindManyMock.mockResolvedValue([
      {
        a2aMetadata: {
          cognitiveLoad: {
            dedupeKey: "capacity:backlog-review:BI-123",
          },
        },
      },
    ]);
    backlogFindManyMock.mockResolvedValue([
      {
        id: "internal-1",
        itemId: "BI-123",
        title: "Clarify stale AI operations spec",
        body: null,
        priority: 1,
        updatedAt: new Date("2026-05-01T00:00:00.000Z"),
        epic: null,
      },
    ]);

    const { selectBacklogReviewCapacityCandidates } = await import("./backlog-selector");

    await expect(
      selectBacklogReviewCapacityCandidates({
        agentId: "agent-capacity",
        ownerPrincipalId: "principal-owner",
      }),
    ).resolves.toEqual([]);
  });
});

describe("selectBacklogReviewCapacityWorkInputs", () => {
  beforeEach(() => {
    backlogFindManyMock.mockReset();
    taskRunFindManyMock.mockReset();
  });

  it("maps selected backlog candidates to ready autonomous work inputs", async () => {
    taskRunFindManyMock.mockResolvedValue([]);
    backlogFindManyMock.mockResolvedValue([
      {
        id: "internal-1",
        itemId: "BI-123",
        title: "Clarify stale AI operations spec",
        body: null,
        priority: 1,
        updatedAt: new Date("2026-05-01T00:00:00.000Z"),
        epic: null,
      },
    ]);

    const { selectBacklogReviewCapacityWorkInputs } = await import("./backlog-selector");

    const result = await selectBacklogReviewCapacityWorkInputs({
      agentId: "agent-capacity",
      ownerPrincipalId: "principal-owner",
      resolvedTools: [{ name: "list_backlog_items" }],
    });

    expect(result.inputs).toEqual([
      expect.objectContaining({
        trigger: "capacity-continuity",
        userId: "principal-owner",
        agentId: "agent-capacity",
        sourceRef: { kind: "backlog-item", id: "BI-123" },
      }),
    ]);
    expect(result.rejections).toEqual([]);
  });

  it("returns structured rejections when selected work requires forbidden grants", async () => {
    taskRunFindManyMock.mockResolvedValue([]);
    backlogFindManyMock.mockResolvedValue([
      {
        id: "internal-1",
        itemId: "BI-123",
        title: "Clarify stale AI operations spec",
        body: null,
        priority: 1,
        updatedAt: new Date("2026-05-01T00:00:00.000Z"),
        epic: null,
      },
    ]);

    const { selectBacklogReviewCapacityWorkInputs } = await import("./backlog-selector");

    const result = await selectBacklogReviewCapacityWorkInputs({
      agentId: "agent-capacity",
      ownerPrincipalId: "principal-owner",
      resolvedTools: [{ name: "deploy_release" }],
    });

    expect(result.inputs).toEqual([]);
    expect(result.rejections).toEqual([
      {
        candidateId: "backlog-review:BI-123",
        rejection: expect.objectContaining({
          code: "forbidden_grant",
        }),
      },
    ]);
  });
});
