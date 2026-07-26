import { describe, expect, it, vi } from "vitest";

import type { WorkPatternMetadata } from "./work-pattern-types";
import { getWorkPatternReadModel } from "./work-pattern-read-model";

const now = new Date("2026-06-28T12:00:00.000Z");

function pattern(overrides: Partial<WorkPatternMetadata> = {}): WorkPatternMetadata {
  return {
    patternKey: "grant-denial|build-specialist|/build",
    status: "observed",
    scope: "route",
    version: 1,
    source: "observer",
    decisionScope: "platform-wwmd",
    evidence: [{ taskRunId: "TR-1", toolExecutionId: "TE-1" }],
    candidate: {
      kind: "grant",
      need: "Missing sandbox lease grant",
      blocks: "Repeated grant denials blocked local integration verification.",
      fingerprint: "fp-grant",
      evaluationMethod: "deterministic-pattern-observer",
    },
    observedAt: "2026-06-28T10:00:00.000Z",
    ...overrides,
  };
}

function taskRun(input: {
  taskRunId: string;
  status: string;
  metadata?: WorkPatternMetadata;
  repeatedPatternKey?: string | null;
  createdAt?: Date;
  completedAt?: Date | null;
}) {
  const repeatedPatternKey =
    input.repeatedPatternKey ?? input.metadata?.patternKey ?? "grant-denial|build-specialist|/build";
  return {
    taskRunId: input.taskRunId,
    currentAgentId: "build-specialist",
    initiatingAgentId: "planner",
    routeContext: "/build",
    title: `Run ${input.taskRunId}`,
    status: input.status,
    repeatedPatternKey,
    a2aMetadata: input.metadata
      ? {
          riskClass: "medium-risk",
          workPattern: input.metadata,
        }
      : { riskClass: "medium-risk" },
    createdAt: input.createdAt ?? new Date("2026-06-28T10:00:00.000Z"),
    completedAt: input.completedAt ?? new Date("2026-06-28T10:05:00.000Z"),
  };
}

function capabilityNeed(input: {
  needId: string;
  patternKey: string;
  status?: string;
  kind?: string;
  routeContext?: string | null;
  evidenceJson?: Record<string, unknown>;
  readinessJson?: Record<string, unknown>;
}) {
  return {
    needId: input.needId,
    agentId: "build-specialist",
    kind: input.kind ?? "grant",
    severity: "important",
    status: input.status ?? "submitted",
    need: "Missing sandbox lease grant",
    blocks: "The coworker cannot claim local integration evidence without the grant.",
    evidenceJson: {
      patternKey: input.patternKey,
      fingerprint: "fp-grant",
      taskRunId: "TR-1",
      toolExecutionId: "TE-1",
      ...input.evidenceJson,
    },
    readinessJson: {
      readyForReview: true,
      readyForCaseActivation: false,
      blockers: ["pattern-status-not-approved-or-active"],
      ...input.readinessJson,
    },
    linkedBacklogItemId: "BI-1",
    duplicateOfId: null,
    createdAt: new Date("2026-06-28T10:06:00.000Z"),
    updatedAt: new Date("2026-06-28T10:06:00.000Z"),
    assessment: {
      routeContext: input.routeContext ?? "/build",
      trigger: "work-pattern-observer",
      createdAt: new Date("2026-06-28T10:06:00.000Z"),
    },
  };
}

describe("getWorkPatternReadModel", () => {
  it("groups repeated TaskRuns by pattern, route, outcome, risk, and linked needs", async () => {
    const db = {
      listTaskRuns: vi.fn().mockResolvedValue([
        taskRun({ taskRunId: "TR-1", status: "completed" }),
        taskRun({
          taskRunId: "TR-2",
          status: "completed",
          metadata: pattern({ evidence: [{ taskRunId: "TR-2", toolExecutionId: "TE-2" }] }),
          createdAt: new Date("2026-06-28T10:10:00.000Z"),
          completedAt: new Date("2026-06-28T10:14:00.000Z"),
        }),
        taskRun({
          taskRunId: "TR-3",
          status: "failed",
          metadata: pattern({ evidence: [{ taskRunId: "TR-3", toolExecutionId: "TE-3" }] }),
          createdAt: new Date("2026-06-28T10:20:00.000Z"),
          completedAt: new Date("2026-06-28T10:24:00.000Z"),
        }),
      ]),
      listCapabilityNeeds: vi.fn().mockResolvedValue([
        capabilityNeed({
          needId: "NEED-1",
          patternKey: "grant-denial|build-specialist|/build",
          evidenceJson: {
            currentAutonomyLevel: "shadow",
            shadowTrials: Array.from({ length: 20 }, (_, index) => ({
              trialId: `S-${index + 1}`,
              riskClass: "internal-reversible",
              candidateDecision: "file grant need",
              actualDecision: index === 19 ? "defer" : "file grant need",
              outcome: index === 19 ? "missed" : "accepted",
              agreement: index !== 19,
              toolCallDelta: -2,
              failureDelta: -1,
              manualTouchDelta: 0,
              contextTokenDelta: -900,
              reviewFailureDelta: 0,
              observedAt: "2026-06-28T10:30:00.000Z",
            })),
          },
          readinessJson: {
            activationProposed: true,
            workPatternReview: {
              action: "approve",
              status: "approved-candidate",
              needId: "NEED-1",
              agentId: "build-specialist",
              patternKey: "grant-denial|build-specialist|/build",
              routeContext: "/build",
              riskClass: "internal-reversible",
              decisionScope: "platform-wwmd",
              decisionInteractionId: "DI-REVIEW001",
              reviewerUserId: "user-1",
              reviewedAt: "2026-06-28T11:00:00.000Z",
              reviewerNote: "Approve only for sandbox lease filing.",
              blockers: ["activation-candidate-awaits-governed-promotion"],
              activationProposed: true,
              activationCandidate: {
                state: "candidate",
                activationAllowed: false,
                patternKey: "grant-denial|build-specialist|/build",
                agentId: "build-specialist",
                routeContext: "/build",
                riskClass: "internal-reversible",
                decisionScope: "platform-wwmd",
                currentAutonomyLevel: "shadow",
                proposedAutonomyLevel: "propose",
                evidenceSummary: {
                  samples: 20,
                  agreements: 19,
                  agreementRate: 0.95,
                },
                blockers: ["activation-candidate-awaits-governed-promotion"],
              },
              caseStaging: {
                status: "stageable",
                activationAllowed: false,
                liveMutationAllowed: false,
                caseRef: {
                  caseId: "backlog-item:BI-123",
                  sourceType: "backlog-item",
                  sourceId: "BI-123",
                },
                action: "propose",
                transitionId: "work-pattern:backlog-item:BI-123:propose:DI-REVIEW001",
                stagedTransition: {
                  transitionId: "work-pattern:backlog-item:BI-123:propose:DI-REVIEW001",
                  action: "propose",
                  status: "proposed",
                  caseState: "awaiting-decision",
                  a2aStatus: "input-required",
                  terminal: false,
                  committable: false,
                  sourceRef: {
                    kind: "decision-interaction",
                    id: "DI-REVIEW001",
                    status: "proposed",
                  },
                  reason: "Transition propose is proposed and waiting for approve/edit/reject/respond.",
                  nextAction: "Resolve staged transition",
                },
                enforcementMode: "governed-action",
                requiredReceiptKind: "governed-action",
                receiptCoverage: "required-before-commit",
                blockers: ["receipt-required-before-commit"],
                proposalRail: {
                  kind: "coworker-action-envelope-preview",
                  envelopeStatus: "proposed",
                  manifestActionId: "work-case.propose",
                  argsJson: {
                    caseRef: "backlog-item:BI-123",
                    action: "propose",
                  },
                  rationale: "Stage Work Case proposal from approved Living Playbook candidate.",
                },
              },
            },
          },
        }),
        capabilityNeed({
          needId: "NEED-2",
          patternKey: "tool-surface|build-specialist|/build",
          kind: "tool",
        }),
      ]),
    };

    const model = await getWorkPatternReadModel({ agentId: "build-specialist", now }, { db });

    expect(model.summary.totalPatterns).toBe(2);
    expect(model.summary.totalObservedRuns).toBe(3);
    expect(model.summary.openNeedCount).toBe(2);

    const observed = model.patterns.find(
      (item) => item.patternKey === "grant-denial|build-specialist|/build",
    );
    expect(observed).toMatchObject({
      agentId: "build-specialist",
      routeContext: "/build",
      riskClass: "medium-risk",
      status: "observed",
      scope: "route",
      observedRuns: 3,
      completedRuns: 2,
      failedRuns: 1,
      openNeedCount: 1,
      candidateNeedKinds: ["grant"],
      linkedNeedIds: ["NEED-1"],
    });
    expect(observed?.outcomeCounts).toEqual({ completed: 2, failed: 1 });
    expect(observed?.latestObservedAt?.toISOString()).toBe("2026-06-28T10:24:00.000Z");
    expect(observed?.evidenceRefs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ taskRunId: "TR-1", toolExecutionId: "TE-1" }),
        expect.objectContaining({ taskRunId: "TR-2", toolExecutionId: "TE-2" }),
        expect.objectContaining({ taskRunId: "TR-3", toolExecutionId: "TE-3" }),
      ]),
    );
    expect(observed?.readiness.blockers).toContain("pattern-status-not-approved-or-active");
    expect(observed?.activationProposed).toBe(true);
    expect(observed?.reviewState).toMatchObject({
      action: "approve",
      status: "approved-candidate",
      decisionInteractionId: "DI-REVIEW001",
    });
    expect(observed?.activationCandidate).toMatchObject({
      activationAllowed: false,
      currentAutonomyLevel: "shadow",
      proposedAutonomyLevel: "propose",
    });
    expect(observed?.caseStaging).toMatchObject({
      status: "stageable",
      action: "propose",
      receiptCoverage: "required-before-commit",
    });
    expect(observed?.reviewState?.caseStaging).toMatchObject({
      status: "stageable",
      stagedTransition: expect.objectContaining({
        caseState: "awaiting-decision",
        committable: false,
      }),
    });
    expect(observed?.evidenceRefs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ decisionInteractionId: "DI-REVIEW001" }),
      ]),
    );
    expect(observed?.shadowEvaluation).toMatchObject({
      samples: 20,
      agreements: 19,
      agreementRate: 0.95,
      decision: "approve-narrower-scope",
      activationAllowed: false,
      riskClass: "internal-reversible",
      improvementTotals: {
        toolCallDelta: -40,
        failureDelta: -20,
        manualTouchDelta: 0,
        contextTokenDelta: -18000,
        reviewFailureDelta: 0,
      },
      trustRecommendation: {
        action: "promote",
        from: "shadow",
        to: "propose",
      },
    });

    const candidateOnly = model.patterns.find(
      (item) => item.patternKey === "tool-surface|build-specialist|/build",
    );
    expect(candidateOnly).toMatchObject({
      status: "candidate",
      observedRuns: 0,
      openNeedCount: 1,
      candidateNeedKinds: ["tool"],
      linkedNeedIds: ["NEED-2"],
      routeContext: "/build",
      activationProposed: false,
      reviewState: null,
      activationCandidate: null,
      shadowEvaluation: null,
    });
  });

  it("projects a running governed experiment onto its existing Living Playbook", async () => {
    const manifest = {
      schemaVersion: 1 as const,
      experimentDefinitionKey: "WPD-1",
      experimentRunId: "WPR-1",
      replicate: 1,
      patternKey: "review-loop",
      activityKey: "build.review",
      riskClass: "internal-reversible" as const,
      methodVariants: [
        { methodVariantKey: "baseline", patternVersion: 1 },
        { methodVariantKey: "candidate", patternVersion: 2 },
      ],
      modelVariants: [
        { modelVariantKey: "model-a", modelProfileId: "profile-a" },
        { modelVariantKey: "model-b", modelProfileId: "profile-b" },
      ],
      requiredCellKeys: [
        "baseline:model-a",
        "baseline:model-b",
        "candidate:model-a",
        "candidate:model-b",
      ],
      taskCorpusKey: "review-fixtures",
      taskCorpusVersion: "1",
      oracleKey: "review-oracle",
      oracleVersion: "1",
      promotionPolicyKey: "bounded-promotion",
      promotionPolicyVersion: 1,
      installScope: "canonical" as const,
      lifecycle: "running" as const,
    };
    const db = {
      listTaskRuns: vi.fn().mockResolvedValue([
        {
          taskRunId: "TR-WPX-1",
          currentAgentId: "build-specialist",
          initiatingAgentId: "build-specialist",
          routeContext: "/build",
          status: "working",
          repeatedPatternKey: "work-pattern-experiment:WPD-1",
          a2aMetadata: {
            workPatternExperiment: manifest,
            workPatternExperimentProjection: {
              evidenceOrigin: "hermetic-replay",
              validPairCount: 0,
              resultSummary: "Candidate and baseline are still running.",
              moreEvidenceNeeded: true,
              invalidPairReasons: [],
              freshnessAt: "2026-06-28T11:30:00.000Z",
            },
          },
          createdAt: new Date("2026-06-28T11:00:00.000Z"),
          completedAt: null,
        },
        {
          taskRunId: "TR-WPC-1",
          currentAgentId: "build-specialist",
          initiatingAgentId: "build-specialist",
          routeContext: "/build",
          status: "submitted",
          repeatedPatternKey: "work-pattern-experiment:WPD-1",
          a2aMetadata: {
            workPatternExperimentCell: {
              schemaVersion: 1,
              experimentRunId: "WPR-1",
              experimentDefinitionKey: "WPD-1",
              cellKey: "baseline:model-a",
              pairKey: "pair",
              methodVariantKey: "baseline",
              modelVariantKey: "model-a",
              attempt: 1,
            },
          },
          createdAt: new Date("2026-06-28T11:01:00.000Z"),
          completedAt: null,
        },
      ]),
      listCapabilityNeeds: vi.fn().mockResolvedValue([]),
    };

    const model = await getWorkPatternReadModel({ agentId: "build-specialist", now }, { db });

    expect(model.patterns).toHaveLength(1);
    expect(model.patterns[0]).toMatchObject({
      patternKey: "review-loop",
      experiment: {
        label: "Testing a better method",
        lifecycle: "running",
        validPairCount: 0,
        evidenceOrigin: "hermetic-replay",
        moreEvidenceNeeded: true,
        methodVariants: ["baseline", "candidate"],
        modelVariants: ["model-a", "model-b"],
      },
    });
  });

  it("keeps invalid completed evidence visible without styling it as active", async () => {
    const db = {
      listTaskRuns: vi.fn().mockResolvedValue([
        {
          taskRunId: "TR-WPX-2",
          currentAgentId: "build-specialist",
          initiatingAgentId: "build-specialist",
          routeContext: "/build",
          status: "completed",
          repeatedPatternKey: "work-pattern-experiment:WPD-2",
          a2aMetadata: {
            workPatternExperiment: {
              schemaVersion: 1,
              experimentDefinitionKey: "WPD-2",
              experimentRunId: "WPR-2",
              replicate: 1,
              patternKey: "review-loop",
              activityKey: "build.review",
              riskClass: "internal-reversible",
              methodVariants: [{ methodVariantKey: "candidate", patternVersion: 2 }],
              modelVariants: [{ modelVariantKey: "model-a", modelProfileId: "profile-a" }],
              requiredCellKeys: ["candidate:model-a"],
              taskCorpusKey: "review-fixtures",
              taskCorpusVersion: "1",
              oracleKey: "review-oracle",
              oracleVersion: "1",
              promotionPolicyKey: "bounded-promotion",
              promotionPolicyVersion: 1,
              installScope: "canonical",
              lifecycle: "completed",
            },
            workPatternExperimentProjection: {
              evidenceOrigin: "matched-cohort",
              validPairCount: 0,
              resultSummary: "The evidence could not be compared safely.",
              moreEvidenceNeeded: true,
              invalidPairReasons: ["source_commit_mismatch"],
              freshnessAt: "2026-06-28T11:30:00.000Z",
            },
          },
          createdAt: new Date("2026-06-28T11:00:00.000Z"),
          completedAt: new Date("2026-06-28T11:30:00.000Z"),
        },
      ]),
      listCapabilityNeeds: vi.fn().mockResolvedValue([]),
    };

    const model = await getWorkPatternReadModel({ agentId: "build-specialist", now }, { db });

    expect(model.patterns[0]?.experiment).toMatchObject({
      lifecycle: "completed",
      validPairCount: 0,
      invalidPairReasons: ["source_commit_mismatch"],
      resultSummary: "The evidence could not be compared safely.",
    });
    expect(model.patterns[0]?.status).not.toBe("active");
  });
});
