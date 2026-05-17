import { describe, expect, it, vi } from "vitest";

import { MARK_DPF_PLATFORM_PROFILE } from "./default-profile";
import { evaluateBuildStudioPlanAdvancementGate } from "./build-studio-gate";
import type { FeatureBuildRow } from "@/lib/feature-build-types";

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
          domains: ["build-studio-plan-advancement"],
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
      create: vi.fn().mockImplementation(async (args) => ({
        id: "interaction-row-1",
        ...args.data,
      })),
    },
  };
}

describe("evaluateBuildStudioPlanAdvancementGate", () => {
  it("persists a decision interaction and allows a high-confidence recommendation", async () => {
    const db = makeDb();

    const result = await evaluateBuildStudioPlanAdvancementGate({
      db: db as never,
      build: makeBuild(),
    });

    expect(result.allowed).toBe(true);
    expect(result.evaluation.outcomeType).toBe("recommend");
    expect(result.evaluation.question).toContain("Start implementation");
    expect(result.evaluation.sources.length).toBeGreaterThan(0);
    expect(result.evaluation.resolvedProfileChain).toContain(MARK_DPF_PLATFORM_PROFILE.profileId);
    expect(db.decisionInteraction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          buildId: "FB-WWMD001",
          deliberationRunId: "delib-1",
          phaseFrom: "plan",
          phaseTo: "build",
          outcomeType: "recommend",
        }),
      }),
    );
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
});
