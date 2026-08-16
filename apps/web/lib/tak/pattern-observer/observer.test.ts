import { describe, expect, it, vi } from "vitest";

import {
  assessToolSurface as realAssessToolSurface,
  computeToolSelectionAccuracy as realComputeToolSelectionAccuracy,
} from "@/lib/tak/context-economy-metrics";

import {
  observeCoworkerPatterns,
  type ObserveCoworkerPatternsDeps,
  type PatternObserverTaskRunRow,
  type PatternObserverToolExecutionRow,
} from "./observer";

const now = new Date("2026-06-27T18:00:00.000Z");

function toolExecution(
  input: Partial<PatternObserverToolExecutionRow> & { toolName: string; success: boolean },
): PatternObserverToolExecutionRow {
  return {
    id: input.id ?? `${input.toolName}-1`,
    agentId: input.agentId ?? "agent-build",
    routeContext: input.routeContext ?? "/build",
    toolName: input.toolName,
    success: input.success,
    summary: input.summary ?? null,
    result: input.result ?? null,
    parameters: input.parameters ?? {},
    taskRunId: input.taskRunId ?? null,
    createdAt: input.createdAt ?? new Date("2026-06-27T17:30:00.000Z"),
  };
}

function taskRun(
  input: Partial<PatternObserverTaskRunRow> & { taskRunId: string },
): PatternObserverTaskRunRow {
  return {
    taskRunId: input.taskRunId,
    currentAgentId: input.currentAgentId ?? "agent-build",
    routeContext: input.routeContext ?? "/build",
    title: input.title ?? "Run a manual workflow",
    status: input.status ?? "completed",
    repeatedPatternKey: input.repeatedPatternKey ?? null,
    a2aMetadata: input.a2aMetadata ?? null,
    createdAt: input.createdAt ?? new Date("2026-06-27T17:00:00.000Z"),
    completedAt: input.completedAt ?? new Date("2026-06-27T17:10:00.000Z"),
  };
}

function makeDeps(input?: {
  toolExecutions?: PatternObserverToolExecutionRow[];
  taskRuns?: PatternObserverTaskRunRow[];
}): ObserveCoworkerPatternsDeps {
  return {
    db: {
      toolExecution: {
        findMany: vi.fn(async () => input?.toolExecutions ?? []),
      },
      taskRun: {
        findMany: vi.fn(async () => input?.taskRuns ?? []),
      },
    },
    assessToolSurface: vi.fn(realAssessToolSurface),
    computeToolSelectionAccuracy: vi.fn(realComputeToolSelectionAccuracy),
    submitCoworkerSelfAssessment: vi.fn(async () => ({
      assessmentId: "CWSA-1",
      needIds: ["CWN-1"],
      backlogItemIds: [],
    })),
    now: () => now,
  };
}

function submittedAssessment(deps: ObserveCoworkerPatternsDeps) {
  const submit = vi.mocked(deps.submitCoworkerSelfAssessment);
  expect(submit).toHaveBeenCalledTimes(1);
  return submit.mock.calls[0]?.[0];
}

function largeToolSurface() {
  return Array.from({ length: 16 }, (_, index) => ({
    type: "function",
    function: {
      name: `tool_${index}`,
      description:
        "A deliberately verbose tool definition used to make the observer preserve token evidence.",
      parameters: {
        type: "object",
        properties: {
          payload: {
            type: "string",
            description: "Long payload description for context-economy token estimation.",
          },
        },
      },
    },
  }));
}

describe("observeCoworkerPatterns", () => {
  it("submits a grant need, not a generic skill need, for repeated grant denials", async () => {
    const deps = makeDeps({
      toolExecutions: [
        toolExecution({
          id: "te-1",
          toolName: "record_execution_evidence",
          success: false,
          summary: "forbidden_grant: execution.write required",
          result: { error: "forbidden_grant", requiredGrant: "execution.write" },
        }),
        toolExecution({
          id: "te-2",
          toolName: "record_execution_evidence",
          success: false,
          summary: "missing capability execution.write",
          result: { error: "missing capability execution.write" },
        }),
        toolExecution({
          id: "te-3",
          toolName: "record_execution_evidence",
          success: false,
          summary: "insufficient_token_scope: requiredScope write",
          result: { error: "insufficient_token_scope", requiredScope: "write" },
        }),
      ],
    });

    const result = await observeCoworkerPatterns(
      {
        agentId: "agent-build",
        routeContext: "/build",
        windowMs: 60 * 60 * 1000,
        contextWindowTokens: 4096,
      },
      deps,
    );

    expect(result).toEqual({ processed: 1, submitted: true });
    expect(deps.db.toolExecution.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          agentId: "agent-build",
          routeContext: "/build",
          createdAt: { gte: new Date("2026-06-27T17:00:00.000Z"), lte: now },
        }),
      }),
    );

    const assessment = submittedAssessment(deps);
    expect(assessment).toMatchObject({
      agentId: "agent-build",
      trigger: "pattern-observer",
      routeContext: "/build",
      verdict: "gaps",
      confidence: "high",
      needs: [
        expect.objectContaining({
          kind: "grant",
          severity: "important",
          evidenceJson: expect.objectContaining({
            classifier: "grant-denial",
            deniedTool: "record_execution_evidence",
            missingCapability: "execution.write",
            count: 3,
            capabilityNeedKey: expect.any(String),
            evidenceFingerprint: expect.any(String),
          }),
        }),
      ],
    });
    expect(assessment?.needs.some((need) => need.kind === "skill")).toBe(false);
    expect(assessment?.rawPayload).toMatchObject({
      window: {
        since: "2026-06-27T17:00:00.000Z",
        until: "2026-06-27T18:00:00.000Z",
        routeContext: "/build",
      },
      evidenceDigest: {
        toolExecutionCount: 3,
        taskRunCount: 0,
      },
      classifierSummary: expect.objectContaining({
        grantDenialCandidates: 1,
        submittedNeeds: 1,
      }),
    });
  });

  it("submits a context-economy need with token evidence for an overloaded tool window", async () => {
    const deps = makeDeps();

    await observeCoworkerPatterns(
      {
        agentId: "agent-build",
        routeContext: "/build",
        toolSurface: largeToolSurface(),
        contextWindowTokens: 1000,
      },
      deps,
    );

    const assessment = submittedAssessment(deps);
    expect(deps.assessToolSurface).toHaveBeenCalledWith({
      tools: expect.any(Array),
      windowTokens: 1000,
    });
    expect(deps.computeToolSelectionAccuracy).toHaveBeenCalledWith([]);
    expect(assessment?.needs).toEqual([
      expect.objectContaining({
        kind: "tool",
        evidenceJson: expect.objectContaining({
          classifier: "tool-surface-overload",
          toolCount: 16,
          estDefinitionTokens: expect.any(Number),
          windowShare: expect.any(Number),
          zone: "overload",
          exceedsLocalCliff: true,
        }),
      }),
    ]);
    expect(assessment?.rawPayload?.evidenceDigest).toMatchObject({
      contextEconomy: {
        toolSurfaceAssessment: expect.objectContaining({
          toolCount: 16,
          zone: "overload",
        }),
      },
    });
  });

  it("does NOT assert tool-surface overload from an execution-derived surface (BI-98D17D0B)", async () => {
    // Periodic-review path: no toolSurface passed, so the observer reconstructs
    // it from executed tools. Even 18 distinct calls with degraded selection —
    // which would trip the count-proxy overload — must NOT fire, because the
    // execution-derived surface omits the ~68-tool attached read baseline and is
    // not a valid basis for an overload assertion.
    const execs = Array.from({ length: 18 }, (_, i) =>
      toolExecution({ toolName: `called_tool_${i}`, success: i % 3 !== 0 }),
    );
    const deps = makeDeps({ toolExecutions: execs });

    await observeCoworkerPatterns(
      { agentId: "agent-build", routeContext: "/build" /* no toolSurface, no window */ },
      deps,
    );

    const submit = vi.mocked(deps.submitCoworkerSelfAssessment);
    if (submit.mock.calls.length > 0) {
      const needs = submit.mock.calls[0]?.[0]?.needs ?? [];
      expect(
        needs.some((n) => n.evidenceJson?.classifier === "tool-surface-overload"),
      ).toBe(false);
    }
    // (No overload candidate ⇒ possibly no assessment submitted at all — both are
    // acceptable; the invariant is simply that no tool-surface-overload need fires.)
  });

  it("submits a code or convention need for a repeated successful manual workflow", async () => {
    const deps = makeDeps({
      taskRuns: [
        taskRun({
          taskRunId: "TR-1",
          a2aMetadata: {
            manualWorkflow: {
              key: "local-ci-lease",
              name: "local CI lease evidence",
              ceremonyScore: 0.9,
            },
          },
        }),
        taskRun({
          taskRunId: "TR-2",
          a2aMetadata: {
            manualWorkflow: {
              key: "local-ci-lease",
              name: "local CI lease evidence",
              ceremonyScore: 0.85,
            },
          },
        }),
        taskRun({
          taskRunId: "TR-3",
          a2aMetadata: {
            manualWorkflow: {
              key: "local-ci-lease",
              name: "local CI lease evidence",
              ceremonyScore: 0.8,
            },
          },
        }),
      ],
      toolExecutions: [
        toolExecution({ toolName: "claim_nonprod_environment_lease", success: true, taskRunId: "TR-1" }),
        toolExecution({ toolName: "record_workroom_evidence", success: true, taskRunId: "TR-2" }),
        toolExecution({ toolName: "release_nonprod_environment_lease", success: true, taskRunId: "TR-3" }),
      ],
    });

    await observeCoworkerPatterns({ agentId: "agent-build", routeContext: "/build" }, deps);

    const assessment = submittedAssessment(deps);
    expect(assessment?.needs).toEqual([
      expect.objectContaining({
        kind: expect.stringMatching(/^(code|convention)$/),
        severity: "minor",
        evidenceJson: expect.objectContaining({
          classifier: "repeated-success",
          workflowName: "local CI lease evidence",
          repetitionCount: 3,
          ceremonyScore: expect.closeTo(0.85, 5),
          accuracy: 1,
        }),
      }),
    ]);
  });

  it("dedupes duplicate needs within one sweep", async () => {
    const manualWorkflow = (key: string) => ({
      manualWorkflow: {
        key,
        name: "local CI lease evidence",
        ceremonyScore: 0.9,
      },
    });
    const deps = makeDeps({
      taskRuns: [
        taskRun({ taskRunId: "TR-A1", a2aMetadata: manualWorkflow("lease-a") }),
        taskRun({ taskRunId: "TR-A2", a2aMetadata: manualWorkflow("lease-a") }),
        taskRun({ taskRunId: "TR-A3", a2aMetadata: manualWorkflow("lease-a") }),
        taskRun({ taskRunId: "TR-B1", a2aMetadata: manualWorkflow("lease-b") }),
        taskRun({ taskRunId: "TR-B2", a2aMetadata: manualWorkflow("lease-b") }),
        taskRun({ taskRunId: "TR-B3", a2aMetadata: manualWorkflow("lease-b") }),
      ],
      toolExecutions: [
        toolExecution({ toolName: "record_workroom_evidence", success: true, taskRunId: "TR-A1" }),
        toolExecution({ toolName: "record_workroom_evidence", success: true, taskRunId: "TR-A2" }),
        toolExecution({ toolName: "record_workroom_evidence", success: true, taskRunId: "TR-A3" }),
        toolExecution({ toolName: "record_workroom_evidence", success: true, taskRunId: "TR-B1" }),
        toolExecution({ toolName: "record_workroom_evidence", success: true, taskRunId: "TR-B2" }),
        toolExecution({ toolName: "record_workroom_evidence", success: true, taskRunId: "TR-B3" }),
      ],
    });

    await observeCoworkerPatterns({ agentId: "agent-build", routeContext: "/build" }, deps);

    const assessment = submittedAssessment(deps);
    expect(assessment?.needs).toHaveLength(1);
    expect(assessment?.rawPayload?.classifierSummary).toMatchObject({
      repeatedSuccessCandidates: 2,
      duplicateNeedsSuppressed: 1,
      submittedNeeds: 1,
    });
  });

  it("does not submit an assessment when no classifier fires", async () => {
    const deps = makeDeps({
      toolExecutions: [
        toolExecution({ toolName: "read_project_file", success: true }),
        toolExecution({ toolName: "search_code_graph", success: true }),
      ],
      taskRuns: [taskRun({ taskRunId: "TR-1", status: "completed" })],
    });

    await expect(
      observeCoworkerPatterns({
        agentId: "agent-build",
        routeContext: "/build",
        contextWindowTokens: 128000,
      }, deps),
    ).resolves.toEqual({ processed: 0, submitted: false, skippedReason: "no-signals" });

    expect(deps.submitCoworkerSelfAssessment).not.toHaveBeenCalled();
  });
});
