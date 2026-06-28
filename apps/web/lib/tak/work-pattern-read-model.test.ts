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
    expect(observed?.activationProposed).toBe(false);
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
      shadowEvaluation: null,
    });
  });
});
