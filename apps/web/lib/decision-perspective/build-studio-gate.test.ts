import { describe, expect, it, vi, afterEach } from "vitest";

import { MARK_DPF_PLATFORM_PROFILE } from "./default-profile";
import { evaluateBuildStudioPlanAdvancementGate } from "./build-studio-gate";
import { PLAN_READINESS_DOMAIN_CLASS } from "./types";
import type { FeatureBuildRow } from "@/lib/feature-build-types";

// Mock the voice synthesis job so it doesn't attempt real DB/API calls in tests
const mockRunVoiceSynthesisJob = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock("../voice-synthesis/synthesis-job", () => ({
  runVoiceSynthesisJob: mockRunVoiceSynthesisJob,
}));

function makeBuild(overrides: Partial<FeatureBuildRow> = {}): FeatureBuildRow {
  return {
    id: "build-row-1",
    buildId: "FB-WWMD001",
    title: "Add governed decision perspective gate",
    description: "Teach Build Studio to ask WWMD before implementation starts.",
    portfolioId: null,
    originatingBacklogItemId: "backlog-row-1",
    brief: {
      title: "Add governed decision perspective gate",
      description: "Add a WWMD autonomy gate before implementation starts.",
      portfolioContext: "Build Studio",
      targetRoles: ["operator"],
      inputs: ["reviewed plan"],
      dataNeeds: "FeatureBuild plan and review evidence",
      acceptanceCriteria: ["The gate writes a decision ledger row."],
    },
    plan: null,
    phase: "plan",
    sandboxId: null,
    sandboxPort: null,
    diffSummary: null,
    diffPatch: null,
    codingProvider: null,
    threadId: "thread-1",
    digitalProductId: null,
    product: null,
    createdById: "user-1",
    createdAt: new Date("2026-05-17T10:00:00.000Z"),
    updatedAt: new Date("2026-05-17T10:00:00.000Z"),
    draftApprovedAt: new Date("2026-05-17T10:05:00.000Z"),
    designDoc: {
      problemStatement: "Build Studio needs an autonomy gate.",
      proposedApproach: "Add a decision perspective service.",
      reusePlan: "Reuse phase gates and deliberation evidence.",
      acceptanceCriteria: ["Decision ledger captures gate outcome."],
    },
    designReview: { decision: "pass", summary: "Good design.", issues: [] },
    buildPlan: {
      fileStructure: [{ path: "apps/web/lib/decision-perspective/build-studio-gate.ts", action: "create", purpose: "Gate service" }],
      tasks: [{ title: "Implement gate", testFirst: "Add gate tests", implement: "Persist interaction", verify: "Run tests" }],
    },
    planReview: { decision: "pass", summary: "Plan is ready.", issues: [] },
    taskResults: null,
    verificationOut: null,
    acceptanceMet: null,
    scoutFindings: null,
    uxTestResults: null,
    uxVerificationStatus: null,
    accountableEmployeeId: "employee-1",
    claimedByAgentId: null,
    claimedAt: null,
    claimStatus: null,
    buildExecState: null,
    deliberationSummary: {
      plan: {
        patternSlug: "review",
        deliberationRunId: "delib-1",
        consensusState: "consensus",
        rationaleSummary: "Reviewer agreed the plan is ready.",
        evidenceQuality: "source-backed",
        unresolvedRisks: [],
        diversityLabel: "Peer review",
      },
    },
    originator: null,
    phaseHandoffs: [],
    happyPathState: {
      intake: {
        status: "ready",
        taxonomyNodeId: "taxonomy-1",
        backlogItemId: "BI-WWMD",
        epicId: "EP-WWMD",
        constrainedGoal: "Add plan advancement gate",
        failureReason: null,
      },
      execution: { engine: null, source: null, status: "pending", failureStage: null },
      verification: { status: "pending", checks: [] },
    },
    ...overrides,
  };
}

function makeDb() {
  return {
    decisionPerspectiveProfile: {
      findUnique: vi.fn().mockResolvedValue({
        ...MARK_DPF_PLATFORM_PROFILE,
        currentVersion: MARK_DPF_PLATFORM_PROFILE.currentVersion,
      }),
    },
    perspectiveMaterial: {
      findMany: vi.fn().mockResolvedValue([
        {
          materialId: "source-1",
          profileId: MARK_DPF_PLATFORM_PROFILE.profileId,
          sourceType: "principle",
          sourceRef: { path: "docs/founder-kernel/wiki/principles/architecture-over-shortcuts.md", principleDirection: "support" },
          summary: "Architecture over shortcuts.",
          domainClass: PLAN_READINESS_DOMAIN_CLASS,
          direction: "support",
          domains: [PLAN_READINESS_DOMAIN_CLASS],
          freshness: "current",
          evidenceGrade: "A",
          confidenceWeight: 1,
          reviewStatus: "approved",
          promotionState: "promoted",
          lastValidatedAt: new Date("2026-05-17T00:00:00.000Z"),
        },
      ]),
    },
    decisionInteraction: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockImplementation(async (args) => ({
        id: "interaction-row-1",
        ...args.data,
      })),
    },
    escalationCapture: {
      // BI-ACF0D6D4: the gate now reads captures and compares each interaction's
      // recommended option against the one the human chose, so a mere count can
      // no longer stand in for "the owner overruled us".
      findMany: vi.fn().mockResolvedValue([]),
    },
  };
}

describe("evaluateBuildStudioPlanAdvancementGate", () => {
  it("persists a decision interaction and allows a high-confidence recommendation", async () => {
    const db = makeDb();
    const trace = vi.spyOn(console, "info").mockImplementation(() => {});

    const result = await evaluateBuildStudioPlanAdvancementGate({
      db: db as never,
      build: makeBuild(),
      triggeredByUserId: "user-1",
      now: new Date("2026-05-17T12:00:00.000Z"),
    });

    expect(result.allowed).toBe(true);
    expect(result.evaluation.outcomeType).toBe("recommend");
    expect(result.evaluation.domainClass).toBe(PLAN_READINESS_DOMAIN_CLASS);
    expect(result.evaluation.question).toContain("Start implementation");
    expect(result.evaluation.sources.length).toBeGreaterThan(0);
    expect(result.evaluation.resolvedProfileChain).toContain(MARK_DPF_PLATFORM_PROFILE.profileId);
    expect(db.decisionInteraction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          buildId: "FB-WWMD001",
          triggeredByUserId: "user-1",
          domainClass: PLAN_READINESS_DOMAIN_CLASS,
          principleConflict: false,
          deliberationRunId: "delib-1",
          phaseFrom: "plan",
          phaseTo: "build",
          outcomeType: "recommend",
        }),
      }),
    );
    expect(trace).toHaveBeenCalledWith(expect.stringContaining("[tool-trace] wwmd.gate.invoked"));
    expect(trace).toHaveBeenCalledWith(expect.stringContaining("[tool-trace] wwmd.ledger.written"));
    trace.mockRestore();
  });

  it("blocks advancement when the profile has a coverage gap", async () => {
    const db = makeDb();
    db.perspectiveMaterial.findMany.mockResolvedValue([]);

    const result = await evaluateBuildStudioPlanAdvancementGate({
      db: db as never,
      build: makeBuild(),
    });

    expect(result.allowed).toBe(false);
    expect(result.evaluation.outcomeType).toBe("defer");
    expect(result.operatorMessage).toContain("coverage gap");
  });

  it("returns an existing open interaction for the same build and profile version without creating a duplicate", async () => {
    const db = makeDb();
    db.decisionInteraction.findFirst.mockResolvedValue({
      interactionId: "DI-EXISTING",
      profileId: MARK_DPF_PLATFORM_PROFILE.profileId,
      profileVersionId: MARK_DPF_PLATFORM_PROFILE.currentVersion.versionId,
      fallbackProfileId: null,
      buildId: "FB-WWMD001",
      taskRunId: null,
      deliberationRunId: "delib-1",
      routeContext: "/build",
      phaseFrom: "plan",
      phaseTo: "build",
      domainClass: PLAN_READINESS_DOMAIN_CLASS,
      question: "Start implementation for an existing plan?",
      options: ["Start implementation"],
      evidenceBundle: {
        materialCount: 1,
        freshnessDistribution: { current: 1, stale: 0, superseded: 0, contradicted: 0 },
        resolvedProfileChain: [MARK_DPF_PLATFORM_PROFILE.profileId],
      },
      sources: [{ materialId: "source-1", sourceType: "principle", summary: "Architecture.", effectiveWeight: 1 }],
      rationale: "Existing recommendation.",
      riskTier: "medium",
      confidenceBefore: 0.9,
      confidenceAfter: 0.9,
      outcomeType: "recommend",
      outcomePayload: {
        confidenceScore: 0.9,
        coverageGap: false,
        principleConflict: false,
        materialCount: 1,
        freshnessDistribution: { current: 1, stale: 0, superseded: 0, contradicted: 0 },
        resolvedProfileChain: [MARK_DPF_PLATFORM_PROFILE.profileId],
      },
      humanOutcome: null,
      escalationCapture: null,
    });
    const trace = vi.spyOn(console, "info").mockImplementation(() => {});

    const result = await evaluateBuildStudioPlanAdvancementGate({
      db: db as never,
      build: makeBuild(),
    });

    expect(result.allowed).toBe(true);
    expect(result.interactionId).toBe("DI-EXISTING");
    expect(db.decisionInteraction.create).not.toHaveBeenCalled();
    expect(trace).toHaveBeenCalledWith(expect.stringContaining("[tool-trace] wwmd.idempotent.hit"));
    trace.mockRestore();
  });

  it("writes a new interaction when the previous gate result has been cleared by escalation capture", async () => {
    const db = makeDb();
    db.decisionInteraction.findFirst.mockResolvedValue({
      interactionId: "DI-CLEARED",
      profileVersionId: MARK_DPF_PLATFORM_PROFILE.currentVersion.versionId,
      humanOutcome: { clearsGate: true },
      escalationCapture: { escalationId: "ESC-1" },
    });

    const result = await evaluateBuildStudioPlanAdvancementGate({
      db: db as never,
      build: makeBuild(),
    });

    expect(result.interactionId).not.toBe("DI-CLEARED");
    expect(db.decisionInteraction.create).toHaveBeenCalledTimes(1);
  });

  it("uses recent same-domain overrides to lower confidence for the current gate", async () => {
    const db = makeDb();
    // Three captures where the human chose something OTHER than the gate's
    // recommendation — genuine overrules, which still lower confidence.
    db.escalationCapture.findMany.mockResolvedValue([
      { interaction: { recommendedOptionId: "opt-a", chosenOptionId: "opt-b" } },
      { interaction: { recommendedOptionId: "opt-a", chosenOptionId: "opt-c" } },
      { interaction: { recommendedOptionId: "opt-d", chosenOptionId: "opt-e" } },
    ]);

    const result = await evaluateBuildStudioPlanAdvancementGate({
      db: db as never,
      build: makeBuild(),
      now: new Date("2026-05-17T12:00:00.000Z"),
    });

    expect(db.escalationCapture.findMany).toHaveBeenCalledWith({
      where: {
        domainClass: PLAN_READINESS_DOMAIN_CLASS,
        createdAt: { gte: new Date("2026-04-17T12:00:00.000Z") },
        interaction: {
          profileId: MARK_DPF_PLATFORM_PROFILE.profileId,
          recommendedOptionId: { not: null },
        },
      },
      select: {
        interaction: { select: { recommendedOptionId: true, chosenOptionId: true } },
      },
    });
    expect(result.allowed).toBe(false);
    expect(result.evaluation.outcomeType).toBe("escalate");
    expect(result.evaluation.confidenceScore).toBe(0.6);
  });

  // The regression BI-ACF0D6D4 fixes: three ANSWERS that agreed with the gate
  // must not read as three overrules. Same volume, opposite meaning.
  it("does not lower confidence when the owner AGREED with the gate", async () => {
    const db = makeDb();
    db.escalationCapture.findMany.mockResolvedValue([
      { interaction: { recommendedOptionId: "opt-a", chosenOptionId: "opt-a" } },
      { interaction: { recommendedOptionId: "opt-a", chosenOptionId: "opt-a" } },
      { interaction: { recommendedOptionId: "opt-b", chosenOptionId: "opt-b" } },
    ]);

    const agreed = await evaluateBuildStudioPlanAdvancementGate({
      db: db as never,
      build: makeBuild(),
      now: new Date("2026-05-17T12:00:00.000Z"),
    });

    const clean = makeDb();
    const baseline = await evaluateBuildStudioPlanAdvancementGate({
      db: clean as never,
      build: makeBuild(),
      now: new Date("2026-05-17T12:00:00.000Z"),
    });

    expect(agreed.evaluation.confidenceScore).toBe(baseline.evaluation.confidenceScore);
  });

  it("preserves a caller-provided graduated risk tier", async () => {
    const db = makeDb();

    const result = await evaluateBuildStudioPlanAdvancementGate({
      db: db as never,
      build: makeBuild(),
      riskTier: "low",
    });

    expect(result.evaluation.riskTier).toBe("low");
    expect(db.decisionInteraction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ riskTier: "low" }),
      }),
    );
  });

  it("fails closed and writes an escalation interaction when evaluation throws", async () => {
    const db = makeDb();
    const trace = vi.spyOn(console, "info").mockImplementation(() => {});

    const result = await evaluateBuildStudioPlanAdvancementGate({
      db: db as never,
      build: makeBuild(),
      evaluator: () => {
        const error = new Error("Malformed material payload");
        error.name = "MalformedPerspectiveInputError";
        throw error;
      },
    });

    expect(result.allowed).toBe(false);
    expect(result.evaluation.outcomeType).toBe("escalate");
    expect(result.evaluation.rationale).toContain("MalformedPerspectiveInputError");
    expect(db.decisionInteraction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          outcomeType: "escalate",
          domainClass: PLAN_READINESS_DOMAIN_CLASS,
          rationale: expect.stringContaining("MalformedPerspectiveInputError"),
        }),
      }),
    );
    expect(trace).toHaveBeenCalledWith(expect.stringContaining("[tool-trace] wwmd.evaluator.failed"));
    trace.mockRestore();
  });

  it("fires voice synthesis job after returning gate result (non-blocking)", async () => {
    vi.useFakeTimers();
    mockRunVoiceSynthesisJob.mockClear();

    const db = makeDb();
    const trace = vi.spyOn(console, "info").mockImplementation(() => {});

    const result = await evaluateBuildStudioPlanAdvancementGate({
      db: db as never,
      build: makeBuild(),
      triggeredByUserId: "user-1",
      now: new Date("2026-05-17T12:00:00.000Z"),
    });

    // Gate returns immediately — synthesis job not yet called (setImmediate deferred)
    expect(result.interactionId).toBeDefined();
    expect(mockRunVoiceSynthesisJob).not.toHaveBeenCalled();

    // Flush setImmediate queue
    await vi.runAllTimersAsync();

    // Now synthesis job was called with the persisted interactionId
    expect(mockRunVoiceSynthesisJob).toHaveBeenCalledWith(result.interactionId);

    vi.useRealTimers();
    trace.mockRestore();
  });
});
