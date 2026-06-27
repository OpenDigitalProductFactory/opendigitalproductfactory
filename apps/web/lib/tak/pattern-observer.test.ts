import { describe, expect, it } from "vitest";
import { classifyPatternSignals } from "./pattern-observer";

function failedTool(input: {
  id?: string;
  toolName: string;
  summary: string;
  taskRunId?: string;
}) {
  return {
    id: input.id ?? `${input.toolName}-failure`,
    toolName: input.toolName,
    success: false,
    summary: input.summary,
    result: { error: input.summary },
    taskRunId: input.taskRunId ?? "run-1",
    createdAt: new Date("2026-06-27T00:01:00Z"),
  };
}

function metric(input: {
  agentMessageId?: string;
  toolSurfaceCount?: number;
  toolDefinitionTokens?: number;
  toolSurfaceExceedsLocalCliff?: boolean;
  toolSelectionAccuracy?: number;
  executedTools?: number;
}) {
  return {
    threadId: "thread-1",
    agentMessageId: input.agentMessageId ?? "msg-1",
    toolSurfaceCount: input.toolSurfaceCount ?? null,
    toolDefinitionTokens: input.toolDefinitionTokens ?? null,
    toolSurfaceExceedsLocalCliff: input.toolSurfaceExceedsLocalCliff ?? null,
    toolSelectionAccuracy: input.toolSelectionAccuracy ?? null,
    executedTools: input.executedTools ?? null,
    createdAt: new Date("2026-06-27T00:02:00Z"),
  };
}

function grantDeniedFixture(priorNeedFingerprints = new Set<string>()) {
  return {
    agentId: "AGT-OPS",
    routeContext: "/ops",
    since: new Date("2026-06-27T00:00:00Z"),
    toolExecutions: [
      failedTool({
        id: "tool-1",
        toolName: "export_archimate",
        summary: "forbidden_grant: ea_graph_read required",
      }),
      failedTool({
        id: "tool-2",
        toolName: "export_archimate",
        summary: "forbidden_grant: ea_graph_read required",
      }),
    ],
    turnMetrics: [],
    taskRuns: [],
    envelopes: [],
    priorNeedFingerprints,
  };
}

describe("classifyPatternSignals", () => {
  it("classifies repeated grant denial as a grant need", () => {
    const out = classifyPatternSignals(grantDeniedFixture());

    expect(out.needs[0]).toMatchObject({
      kind: "grant",
      severity: "important",
    });
    expect(out.needs[0]?.evidenceJson).toMatchObject({
      toolName: "export_archimate",
      occurrences: 2,
    });
    expect(out.patterns[0]?.metadata).toMatchObject({
      status: "observed",
      source: "observer",
      scope: "route",
      candidate: { kind: "grant" },
    });
    expect(out.patterns[0]?.metadata.evidence?.[0]).toEqual({
      taskRunId: "run-1",
      toolExecutionId: "tool-1",
    });
  });

  it("classifies tool-surface overload as a tool need", () => {
    const out = classifyPatternSignals({
      agentId: "AGT-BUILD",
      routeContext: "/build",
      since: new Date("2026-06-27T00:00:00Z"),
      toolExecutions: [],
      taskRuns: [],
      envelopes: [],
      turnMetrics: [
        metric({
          toolSurfaceCount: 18,
          toolSurfaceExceedsLocalCliff: true,
          toolDefinitionTokens: 12000,
        }),
        metric({
          toolSurfaceCount: 17,
          toolSurfaceExceedsLocalCliff: true,
          toolDefinitionTokens: 11800,
        }),
      ],
      priorNeedFingerprints: new Set(),
    });

    expect(out.needs[0]).toMatchObject({
      kind: "tool",
      severity: "important",
      evidenceJson: {
        signal: "tool-surface-overload",
        maxToolSurfaceCount: 18,
      },
    });
    expect(out.patterns[0]?.metadata.patternKey).toContain("tool-surface");
  });

  it("classifies repeated low tool accuracy as a tool need", () => {
    const out = classifyPatternSignals({
      agentId: "AGT-BUILD",
      routeContext: "/build",
      since: new Date("2026-06-27T00:00:00Z"),
      toolExecutions: [],
      taskRuns: [],
      envelopes: [],
      turnMetrics: [
        metric({ toolSelectionAccuracy: 0.5, executedTools: 2 }),
        metric({ toolSelectionAccuracy: 0.4, executedTools: 3 }),
      ],
      priorNeedFingerprints: new Set(),
    });

    expect(out.needs[0]).toMatchObject({
      kind: "tool",
      severity: "important",
      evidenceJson: {
        signal: "low-tool-selection-accuracy",
        minToolSelectionAccuracy: 0.4,
      },
    });
  });

  it("classifies repeated approved envelopes as a convention need only", () => {
    const out = classifyPatternSignals({
      agentId: "AGT-OPS",
      routeContext: "/ops",
      since: new Date("2026-06-27T00:00:00Z"),
      toolExecutions: [],
      turnMetrics: [],
      taskRuns: [],
      envelopes: [
        { id: "env-1", proposedActionKey: "approve-change-window", approved: true },
        { id: "env-2", proposedActionKey: "approve-change-window", approved: true },
      ],
      priorNeedFingerprints: new Set(),
    });

    expect(out.needs[0]).toMatchObject({
      kind: "convention",
      severity: "minor",
      readinessJson: { activationProposed: false },
    });
    expect(out.patterns[0]?.metadata).toMatchObject({
      scope: "activity",
      decisionScope: "profession-wsid",
    });
  });

  it("does not emit duplicate needs already seen in the window", () => {
    const first = classifyPatternSignals(grantDeniedFixture());
    const fingerprint = first.needs[0]?.fingerprint;
    expect(fingerprint).toBeTruthy();

    const out = classifyPatternSignals(grantDeniedFixture(new Set([fingerprint!])));

    expect(out.needs).toHaveLength(0);
    expect(out.patterns).toHaveLength(0);
  });
});
