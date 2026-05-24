import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    featureBuild: { findUnique: vi.fn() },
    backlogItem: { findUnique: vi.fn() },
    buildActivity: { create: vi.fn() },
  },
}));

const { mockDispatchIdeateResearch, mockGetBuildStudioConfig, mockExecuteTool } = vi.hoisted(() => ({
  mockDispatchIdeateResearch: vi.fn(),
  mockGetBuildStudioConfig: vi.fn(),
  mockExecuteTool: vi.fn(),
}));

vi.mock("@dpf/db", () => ({ prisma: mockPrisma }));

vi.mock("./ideate-dispatch", () => ({
  dispatchIdeateResearch: mockDispatchIdeateResearch,
}));

vi.mock("@/lib/integrate/build-studio-config", () => ({
  getBuildStudioConfig: mockGetBuildStudioConfig,
}));

vi.mock("@/lib/mcp-tools", () => ({
  executeTool: mockExecuteTool,
}));

import { dispatchIdeateForApprovedBuild } from "./ideate-on-approval";

describe("dispatchIdeateForApprovedBuild", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.buildActivity.create.mockResolvedValue({});
    mockGetBuildStudioConfig.mockResolvedValue({
      provider: "claude",
      claudeProviderId: "anthropic-sub",
      codexProviderId: "",
      claudeModel: "sonnet",
      codexModel: "",
    });
  });

  it("skips with no-bi outcome when the build is not backlog-promoted", async () => {
    mockPrisma.featureBuild.findUnique.mockResolvedValue({
      originatingBacklogItemId: null,
      designDoc: null,
      title: "Untitled",
      description: "",
    });

    const outcome = await dispatchIdeateForApprovedBuild({ buildId: "FB-X", userId: "u-1" });

    expect(outcome.kind).toBe("skipped-no-bi");
    expect(mockDispatchIdeateResearch).not.toHaveBeenCalled();
    expect(mockExecuteTool).not.toHaveBeenCalled();
    expect(mockPrisma.buildActivity.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          buildId: "FB-X",
          tool: "ideate_dispatch",
          summary: expect.stringContaining("Skipped"),
        }),
      }),
    );
  });

  it("skips with already-has-design outcome when designDoc has a non-empty problemStatement", async () => {
    mockPrisma.featureBuild.findUnique.mockResolvedValue({
      originatingBacklogItemId: "BI-1",
      designDoc: { problemStatement: "Already drafted." },
      title: "T",
      description: "D",
    });

    const outcome = await dispatchIdeateForApprovedBuild({ buildId: "FB-X", userId: "u-1" });

    expect(outcome.kind).toBe("skipped-already-has-design");
    expect(mockDispatchIdeateResearch).not.toHaveBeenCalled();
    expect(mockExecuteTool).not.toHaveBeenCalled();
  });

  it("skips with no-provider outcome when the dispatch config has no external CLI provider", async () => {
    mockPrisma.featureBuild.findUnique.mockResolvedValue({
      originatingBacklogItemId: "BI-1",
      designDoc: null,
      title: "T",
      description: "D",
    });
    mockPrisma.backlogItem.findUnique.mockResolvedValue({ title: "BI Title", body: "BI body content." });
    mockGetBuildStudioConfig.mockResolvedValue({
      provider: "agentic",
      claudeProviderId: "",
      codexProviderId: "",
      claudeModel: "sonnet",
      codexModel: "",
    });

    const outcome = await dispatchIdeateForApprovedBuild({ buildId: "FB-X", userId: "u-1" });

    expect(outcome.kind).toBe("skipped-no-provider");
    expect(mockDispatchIdeateResearch).not.toHaveBeenCalled();
    expect(mockExecuteTool).not.toHaveBeenCalled();
  });

  it("dispatches research and saves designDoc evidence on the happy path", async () => {
    // 2026-05-24: originatingBacklogItemId is a FK to BacklogItem.id (cuid),
    // not BacklogItem.itemId (BI-XXXXX semantic id). Use a cuid-shaped value
    // here so the lookup matches what production code does.
    mockPrisma.featureBuild.findUnique.mockResolvedValue({
      originatingBacklogItemId: "cmpj4gz5605xx01o6lzxt278g",
      designDoc: null,
      title: "Fallback Title",
      description: "Fallback description.",
    });
    mockPrisma.backlogItem.findUnique.mockResolvedValue({
      title: "BI Title",
      body: "Problem statement and acceptance criteria.",
    });
    mockDispatchIdeateResearch.mockResolvedValue({
      success: true,
      designDoc: {
        problemStatement: "P",
        existingFunctionalityAudit: "A",
        proposedApproach: "x".repeat(60),
        acceptanceCriteria: ["one"],
      },
      rawOutput: "",
      durationMs: 1234,
    });
    mockExecuteTool.mockResolvedValue({ success: true });

    const outcome = await dispatchIdeateForApprovedBuild({ buildId: "FB-X", userId: "u-1" });

    expect(outcome.kind).toBe("dispatched-success");
    // Regression guard: PR #947 looked up BacklogItem by itemId here, which
    // always missed because originatingBacklogItemId stores the cuid FK to
    // BacklogItem.id. Live evidence captured on FB-B77B8CC4 2026-05-24.
    // Without this assertion the prior mock setup (which ignored the where
    // clause) hid the bug from tests.
    expect(mockPrisma.backlogItem.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "cmpj4gz5605xx01o6lzxt278g" },
      }),
    );
    expect(mockDispatchIdeateResearch).toHaveBeenCalledWith(
      expect.objectContaining({
        featureTitle: "BI Title",
        featureDescription: "Problem statement and acceptance criteria.",
        providerId: "anthropic-sub",
        dispatchEngine: "claude",
      }),
    );
    expect(mockExecuteTool).toHaveBeenCalledWith(
      "saveBuildEvidence",
      { field: "designDoc", value: expect.objectContaining({ problemStatement: "P" }) },
      "u-1",
      expect.any(Object),
    );
    // Should write at least two activity rows: the "Dispatching..." log and the "Auto-dispatched..." success log.
    expect(mockPrisma.buildActivity.create).toHaveBeenCalledTimes(2);
  });

  it("returns dispatched-failure when dispatchIdeateResearch reports failure", async () => {
    mockPrisma.featureBuild.findUnique.mockResolvedValue({
      originatingBacklogItemId: "BI-1",
      designDoc: null,
      title: "T",
      description: "D",
    });
    mockPrisma.backlogItem.findUnique.mockResolvedValue({ title: "BI Title", body: "Body." });
    mockDispatchIdeateResearch.mockResolvedValue({
      success: false,
      designDoc: null,
      rawOutput: "",
      durationMs: 500,
      error: "auth failed",
    });

    const outcome = await dispatchIdeateForApprovedBuild({ buildId: "FB-X", userId: "u-1" });

    expect(outcome.kind).toBe("dispatched-failure");
    expect(mockExecuteTool).not.toHaveBeenCalled();
  });

  it("returns dispatched-failure when saveBuildEvidence rejects", async () => {
    mockPrisma.featureBuild.findUnique.mockResolvedValue({
      originatingBacklogItemId: "BI-1",
      designDoc: null,
      title: "T",
      description: "D",
    });
    mockPrisma.backlogItem.findUnique.mockResolvedValue({ title: "BI Title", body: "Body." });
    mockDispatchIdeateResearch.mockResolvedValue({
      success: true,
      designDoc: { problemStatement: "P", proposedApproach: "y".repeat(60) },
      rawOutput: "",
      durationMs: 100,
    });
    mockExecuteTool.mockResolvedValue({ success: false, message: "validation failed" });

    const outcome = await dispatchIdeateForApprovedBuild({ buildId: "FB-X", userId: "u-1" });

    expect(outcome.kind).toBe("dispatched-failure");
    if (outcome.kind === "dispatched-failure") {
      expect(outcome.error).toContain("saveBuildEvidence");
    }
  });

  it("never throws when an unexpected error occurs — logs and returns dispatched-failure", async () => {
    mockPrisma.featureBuild.findUnique.mockRejectedValue(new Error("DB connection lost"));

    const outcome = await dispatchIdeateForApprovedBuild({ buildId: "FB-X", userId: "u-1" });

    expect(outcome.kind).toBe("dispatched-failure");
    if (outcome.kind === "dispatched-failure") {
      expect(outcome.error).toContain("DB connection lost");
    }
  });
});
