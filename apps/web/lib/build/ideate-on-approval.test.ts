import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    featureBuild: { findUnique: vi.fn(), findMany: vi.fn(), update: vi.fn() },
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

vi.mock("@/lib/build/build-studio-config", () => ({
  getBuildStudioConfig: mockGetBuildStudioConfig,
  getAutonomousPlaybookMode: () => "off",
  isModelTierRoutingEnabled: async () => false,
  isQualityFirstRightsizingEnabled: async () => true,
}));

vi.mock("@/lib/mcp-tools", () => ({
  executeTool: mockExecuteTool,
}));

const { mockEscalate } = vi.hoisted(() => ({ mockEscalate: vi.fn() }));
vi.mock("@/lib/build/escalate-build-to-human", () => ({
  escalateBuildToHuman: mockEscalate,
  SELF_FIX_CLASS: { AUTO_RECOVERABLE: "auto-recoverable", NEEDS_HUMAN: "needs-human", NEEDS_EXTERNAL_CAPABILITY: "needs-external-capability" },
}));

import {
  dispatchIdeateForApprovedBuild,
  buildNeedsIdeateDispatch,
  getIdeateResearchRequest,
  dispatchApprovedIdeateBuilds,
  dispatchDesignReviewFixLoop,
  DESIGN_FIX_MAX_ROUNDS,
} from "./ideate-on-approval";

function engineSelection(
  engine: "claude" | "codex" | "grok" | "opencode" | "agentic",
  providerId: string,
  fallbacks: Array<{ engine: "claude" | "codex" | "grok" | "opencode" | "agentic"; providerId: string }> = [],
  modelId?: string,
) {
  const make = (entry: { engine: typeof engine; providerId: string }) => ({
    ...entry,
    modelId: modelId ?? (entry.engine === "claude" ? "sonnet" : null),
    local: entry.engine === "opencode",
    registered: true,
    present: true,
    providerStatus: "active",
    authMethod: entry.engine === "opencode" ? "none" : "oauth",
    credentialStatus: entry.engine === "opencode" ? null : "active",
    credentialExpiresAt: null,
    providerCapacityState: "available",
    providerRetryAt: null,
    cliRetryAt: null,
    providerHealth: "healthy" as const,
  });
  return {
    status: "selected" as const,
    policy: { mode: "auto" as const, pinnedEngine: null },
    selected: make({ engine, providerId }),
    reason: `Selected ${providerId} through routeEndpointV2.`,
    rejected: [],
    fallbackChain: fallbacks.map(make),
    fallbackDisabled: false,
    action: null,
  };
}

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
      selection: engineSelection("claude", "anthropic-sub"),
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
      selection: {
        status: "blocked",
        policy: { mode: "auto", pinnedEngine: null },
        selected: null,
        reason: "No eligible engine.",
        rejected: [],
        fallbackChain: [],
        fallbackDisabled: false,
        action: "Connect, provision, or wait for one allowed Build Studio engine, then retry.",
      },
    });

    const outcome = await dispatchIdeateForApprovedBuild({ buildId: "FB-X", userId: "u-1" });

    expect(outcome.kind).toBe("skipped-no-provider");
    expect(mockDispatchIdeateResearch).not.toHaveBeenCalled();
    expect(mockExecuteTool).not.toHaveBeenCalled();
  });

  it("routes Ideate to the LOCAL engine when provider=opencode (not the codex/chatgpt fallback)", async () => {
    mockPrisma.featureBuild.findUnique
      .mockResolvedValueOnce({ originatingBacklogItemId: "cmpcuid1", designDoc: null, title: "T", description: "D" })
      .mockResolvedValueOnce({ designDoc: { problemStatement: "P" } });
    mockPrisma.backlogItem.findUnique.mockResolvedValue({ title: "BI Title", body: "Body." });
    mockGetBuildStudioConfig.mockResolvedValue({
      provider: "opencode",
      opencodeProviderId: "local",
      opencodeModel: "docker.io/ai/qwen3-coder:latest",
      // The codex fallback MUST NOT be used for an opencode install.
      codexProviderId: "chatgpt",
      codexModel: "gpt-5.3-codex",
      claudeProviderId: "", grokProviderId: "", claudeModel: "", grokModel: "",
      selection: engineSelection("opencode", "local", [], "docker.io/ai/qwen3-coder:latest"),
    });
    mockDispatchIdeateResearch.mockResolvedValue({
      success: true,
      designDoc: { problemStatement: "P", proposedApproach: "x".repeat(60) },
      rawOutput: "", durationMs: 1,
    });
    mockExecuteTool.mockResolvedValue({ success: true });

    await dispatchIdeateForApprovedBuild({ buildId: "FB-X", userId: "u-1" });

    expect(mockDispatchIdeateResearch).toHaveBeenCalledWith(
      expect.objectContaining({
        providerId: "local",
        model: "docker.io/ai/qwen3-coder:latest",
        dispatchEngine: "opencode",
      }),
    );
    // Regression guard: it must NOT fall back to the cloud chatgpt provider.
    expect(mockDispatchIdeateResearch).not.toHaveBeenCalledWith(
      expect.objectContaining({ providerId: "chatgpt" }),
    );
  });

  it("falls from a retry-safe pre-dispatch Claude auth failure to Codex once", async () => {
    mockPrisma.featureBuild.findUnique
      .mockResolvedValueOnce({ originatingBacklogItemId: "cmpcuid1", designDoc: null, title: "T", description: "D" })
      .mockResolvedValueOnce({ designDoc: { problemStatement: "P" } });
    mockPrisma.backlogItem.findUnique.mockResolvedValue({ title: "BI Title", body: "Body.", effortSize: "medium", workType: "bug" });
    mockGetBuildStudioConfig.mockResolvedValue({
      provider: "claude",
      claudeProviderId: "anthropic-sub",
      codexProviderId: "codex",
      grokProviderId: "",
      opencodeProviderId: "",
      claudeModel: "sonnet",
      codexModel: "",
      grokModel: "",
      opencodeModel: "",
      selection: engineSelection("claude", "anthropic-sub", [{ engine: "codex", providerId: "codex" }]),
    });
    mockDispatchIdeateResearch
      .mockResolvedValueOnce({ success: false, designDoc: null, rawOutput: "", durationMs: 0, error: "Auth error: OAuth token expired" })
      .mockResolvedValueOnce({ success: true, designDoc: { problemStatement: "P" }, rawOutput: "{}", durationMs: 5 });
    mockExecuteTool.mockResolvedValue({ success: true });

    const outcome = await dispatchIdeateForApprovedBuild({ buildId: "FB-X", userId: "u-1" });

    expect(outcome.kind).toBe("dispatched-success");
    expect(mockDispatchIdeateResearch).toHaveBeenCalledTimes(2);
    expect(mockDispatchIdeateResearch).toHaveBeenNthCalledWith(2, expect.objectContaining({
      dispatchEngine: "codex",
      providerId: "codex",
    }));
    expect(mockPrisma.buildActivity.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ summary: expect.stringMatching(/falling back once to codex/i) }),
    }));
    expect(mockExecuteTool).toHaveBeenCalledTimes(2);
  });

  it("dispatches research and saves designDoc evidence on the happy path", async () => {
    // 2026-05-24: originatingBacklogItemId is a FK to BacklogItem.id (cuid),
    // not BacklogItem.itemId (BI-XXXXX semantic id). Use a cuid-shaped value
    // here so the lookup matches what production code does.
    mockPrisma.featureBuild.findUnique
      .mockResolvedValueOnce({
        originatingBacklogItemId: "cmpj4gz5605xx01o6lzxt278g",
        designDoc: null,
        title: "Fallback Title",
        description: "Fallback description.",
      })
      // read-after-write verification sees the persisted doc on this build
      .mockResolvedValueOnce({ designDoc: { problemStatement: "P" } });
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
    // Regression guard for the wrong-build write bug: the explicit buildId MUST
    // be passed so saveBuildEvidence targets THIS build instead of falling back
    // to resolveActiveBuildId(userId), which mis-resolves when multiple builds
    // are in flight (live evidence: FB-D48D6429, 2026-06-07).
    expect(mockExecuteTool).toHaveBeenCalledWith(
      "saveBuildEvidence",
      { buildId: "FB-X", field: "designDoc", value: expect.objectContaining({ problemStatement: "P" }) },
      "u-1",
      expect.any(Object),
    );
    // Auto-chain (autonomous-flow fix): the design review fires immediately after
    // the designDoc save so the build advances ideate->plan without waiting ~20
    // min for the stranded-build reconciler at each handoff.
    expect(mockExecuteTool).toHaveBeenCalledWith(
      "reviewDesignDoc",
      { buildId: "FB-X" },
      "u-1",
      expect.any(Object),
    );
    // Selection evidence, the dispatch log, and the saved success are visible.
    expect(mockPrisma.buildActivity.create).toHaveBeenCalledTimes(3);
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

  it("returns dispatched-failure when saveBuildEvidence reports success but the designDoc did not persist to this build", async () => {
    // Read-after-write guard: simulates the wrong-build mis-resolution — save
    // reports success, but re-reading THIS build shows no designDoc.
    mockPrisma.featureBuild.findUnique
      .mockResolvedValueOnce({
        originatingBacklogItemId: "BI-1",
        designDoc: null,
        title: "T",
        description: "D",
      })
      .mockResolvedValueOnce({ designDoc: null });
    mockPrisma.backlogItem.findUnique.mockResolvedValue({ title: "BI Title", body: "Body." });
    mockDispatchIdeateResearch.mockResolvedValue({
      success: true,
      designDoc: { problemStatement: "P", proposedApproach: "z".repeat(60) },
      rawOutput: "",
      durationMs: 100,
    });
    mockExecuteTool.mockResolvedValue({ success: true });

    const outcome = await dispatchIdeateForApprovedBuild({ buildId: "FB-X", userId: "u-1" });

    expect(outcome.kind).toBe("dispatched-failure");
    if (outcome.kind === "dispatched-failure") {
      expect(outcome.error).toContain("no designDoc is present");
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

describe("buildNeedsIdeateDispatch (BI-3E0EE3BA)", () => {
  it("is true when there is no real designDoc yet (the DOA pattern)", () => {
    expect(buildNeedsIdeateDispatch(null)).toBe(true);
    expect(buildNeedsIdeateDispatch(undefined)).toBe(true);
    expect(buildNeedsIdeateDispatch({})).toBe(true);
    expect(buildNeedsIdeateDispatch({ problemStatement: "" })).toBe(true);
    expect(buildNeedsIdeateDispatch({ problemStatement: "   " })).toBe(true);
  });
  it("is false once a designDoc with a non-empty problemStatement exists (mirrors the dispatch idempotency guard)", () => {
    expect(buildNeedsIdeateDispatch({ problemStatement: "Solve X" })).toBe(false);
  });
});

describe("getIdeateResearchRequest", () => {
  it("reads an explicit start_ideate_research request and its context", () => {
    expect(getIdeateResearchRequest({
      ideateResearchRequested: true,
      userContext: "Focus on appointment capacity.",
      reusabilityScope: "one-off",
    })).toEqual({
      requested: true,
      userContext: "Focus on appointment capacity.",
      reusabilityScope: "one-off",
    });
  });

  it("ignores missing or false request flags", () => {
    expect(getIdeateResearchRequest(null)).toEqual({ requested: false });
    expect(getIdeateResearchRequest({ ideateResearchRequested: false })).toEqual({ requested: false });
  });
});

describe("dispatchApprovedIdeateBuilds (BI-3E0EE3BA recovery)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.buildActivity.create.mockResolvedValue({});
  });

  it("fires dispatch only for approved drafts still missing a designDoc, bounded by limit", async () => {
    mockPrisma.featureBuild.findMany.mockResolvedValue([
      { buildId: "FB-A", designDoc: null, buildExecState: null },                         // needs
      { buildId: "FB-B", designDoc: { problemStatement: "done" }, buildExecState: null }, // already has → not counted
      { buildId: "FB-C", designDoc: { problemStatement: "" }, buildExecState: null },     // needs
      { buildId: "FB-D", designDoc: null, buildExecState: null },                         // needs
    ]);
    // Inner dispatch returns fast (skipped-no-bi, no LLM) — we're asserting the
    // recovery's selection + iteration, not the dispatch internals.
    mockPrisma.featureBuild.findUnique.mockResolvedValue({
      originatingBacklogItemId: null, designDoc: null, title: "t", description: "",
    });

    const res = await dispatchApprovedIdeateBuilds({ userId: "u-1", limit: 2 });

    // 3 need dispatch (A, C, D); limit caps attempts at 2.
    expect(res.candidates).toBe(2);
    expect(mockPrisma.featureBuild.findUnique).toHaveBeenCalledTimes(2);
    expect(res.dispatched).toBe(0); // both inner dispatches skipped (no-bi)
    expect(res.skipped).toBe(2);
    // Only approved + non-terminal drafts are queried.
    expect(mockPrisma.featureBuild.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          phase: "ideate",
          draftApprovedAt: { not: null },
          abandonedAt: null,
        }),
      }),
    );
  });

  it("consumes an explicit ideate re-request even when a designDoc already exists", async () => {
    mockPrisma.featureBuild.findMany.mockResolvedValue([
      {
        buildId: "FB-R",
        designDoc: { problemStatement: "Existing design." },
        buildExecState: {
          ideateResearchRequested: true,
          userContext: "Re-check capacity conflicts.",
          reusabilityScope: "template",
        },
      },
    ]);
    mockPrisma.featureBuild.findUnique
      .mockResolvedValueOnce({
        originatingBacklogItemId: "cmpcuid-r",
        designDoc: { problemStatement: "Existing design." },
        title: "Fallback Title",
        description: "Fallback description.",
      })
      .mockResolvedValueOnce({ designDoc: { problemStatement: "Revised design." } });
    mockPrisma.backlogItem.findUnique.mockResolvedValue({
      title: "BI Title",
      body: "Original BI body.",
      effortSize: "medium",
    });
    mockDispatchIdeateResearch.mockResolvedValue({
      success: true,
      designDoc: { problemStatement: "Revised design.", proposedApproach: "x".repeat(60) },
      rawOutput: "",
      durationMs: 99,
    });
    mockExecuteTool.mockResolvedValue({ success: true });
    mockPrisma.featureBuild.update.mockResolvedValue({});

    const res = await dispatchApprovedIdeateBuilds({ userId: "u-1" });

    expect(res).toEqual({ candidates: 1, dispatched: 1, skipped: 0 });
    expect(mockDispatchIdeateResearch).toHaveBeenCalledWith(
      expect.objectContaining({
        reusabilityScope: "template",
        userContext: expect.stringContaining("Re-check capacity conflicts."),
      }),
    );
    expect(mockPrisma.featureBuild.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { buildId: "FB-R" },
        data: expect.objectContaining({
          buildExecState: expect.objectContaining({ ideateResearchRequested: false }),
        }),
      }),
    );
  });

  it("is a no-op when there are no approved drafts", async () => {
    mockPrisma.featureBuild.findMany.mockResolvedValue([]);
    const res = await dispatchApprovedIdeateBuilds({ userId: "u-1" });
    expect(res).toEqual({ candidates: 0, dispatched: 0, skipped: 0 });
    expect(mockPrisma.featureBuild.findUnique).not.toHaveBeenCalled();
  });
});

describe("dispatchDesignReviewFixLoop (design-review fix loop)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.buildActivity.create.mockResolvedValue({});
    mockEscalate.mockResolvedValue({ reportId: "PIR-1", wipFreed: true, backlogItemDeferred: true });
  });

  it("does nothing when the last design review did not fail", async () => {
    mockPrisma.featureBuild.findUnique.mockResolvedValue({
      id: "ck1", title: "T", kind: "feature", originatingBacklogItemId: null,
      designReview: { decision: "pass", issues: [] },
    });
    const res = await dispatchDesignReviewFixLoop({ buildId: "FB-X", userId: "u-1" });
    expect(res).toMatchObject({ kind: "no-failed-review", rounds: 0 });
    expect(mockEscalate).not.toHaveBeenCalled();
    expect(mockDispatchIdeateResearch).not.toHaveBeenCalled();
  });

  it("escalates a fix build directly — regenerating the designDoc cannot fill a missing fix diagnosis", async () => {
    mockPrisma.featureBuild.findUnique.mockResolvedValue({
      id: "ck2", title: "Bug fix", kind: "fix", originatingBacklogItemId: null,
      designReview: { decision: "fail", issues: [{ severity: "critical", description: "Incomplete fix diagnosis" }] },
    });
    const res = await dispatchDesignReviewFixLoop({ buildId: "FB-Y", userId: "u-1" });
    expect(res).toMatchObject({ kind: "escalated-fix-diagnosis", rounds: 0 });
    expect(mockEscalate).toHaveBeenCalledWith(
      expect.objectContaining({ buildId: "FB-Y", phase: "ideate", selfFixClass: "needs-human" }),
    );
    expect(mockDispatchIdeateResearch).not.toHaveBeenCalled(); // never tried to regenerate
  });

  // BI-E492F313 — live repro FB-D23311A7: round 1 drew the local model, could
  // not parse its output, and the loop `break`ed and escalated. That abandoned
  // the build, freed the WIP slot and parked the owner's backlog item as
  // deferred — destroying a sound design doc and an actionable review over an
  // infrastructure failure that said nothing about the design.
  it("spends the remaining rounds when a regeneration cannot dispatch, and does not abandon the build", async () => {
    const failedReview = {
      decision: "fail",
      issues: [{ severity: "critical", description: "Concurrency invariant missing" }],
    };
    mockPrisma.featureBuild.findUnique.mockResolvedValue({
      id: "ck3",
      title: "Foster homes",
      kind: "feature",
      originatingBacklogItemId: "cmpcuid1",
      designReview: failedReview,
      designDoc: null,
      description: "D",
    });
    mockPrisma.backlogItem.findUnique.mockResolvedValue({
      title: "BI Title", body: "Body.", effortSize: "medium", workType: "feature",
    });
    mockGetBuildStudioConfig.mockResolvedValue({
      provider: "opencode",
      claudeProviderId: "", codexProviderId: "", grokProviderId: "", opencodeProviderId: "local",
      claudeModel: "", codexModel: "", grokModel: "", opencodeModel: "",
      selection: engineSelection("opencode", "local"),
    });
    // Every attempt fails the way the local model does: it ran, but produced
    // nothing parseable.
    mockDispatchIdeateResearch.mockResolvedValue({
      success: false, designDoc: null, rawOutput: "I think the design should…", durationMs: 231_800,
      error: "Routed ideate output could not be parsed into a design document.",
    });

    const res = await dispatchDesignReviewFixLoop({ buildId: "FB-D23311A7", userId: "u-1" });

    expect(res).toMatchObject({ kind: "blocked-no-regeneration" });
    // Both rounds are spent — engine selection is re-resolved per attempt, so a
    // later round can land on an engine that works.
    expect(res.rounds).toBe(DESIGN_FIX_MAX_ROUNDS);
    // The build is NOT abandoned and the backlog item is NOT deferred.
    expect(mockEscalate).not.toHaveBeenCalled();
  });

});