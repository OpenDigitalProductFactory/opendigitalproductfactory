// apps/web/lib/work-management/coworker-shape-projection.ts
//
// BI-DB302392. The same shape renderer, pointed at one AI coworker instead of
// one room. Same ShapeGraph type, same visual grammar — a second grammar would
// mean two things to learn for one idea.
//
// Honest scope: a coworker's GATED TOOL USE is joinable today (ToolExecution
// carries agentId). Its gate VERDICTS are not — DecisionInteraction has no
// acting-agent column, only the perspective profileId — so the decision stage
// renders empty for a coworker until that link exists, rather than being faked
// from a profile match that would attribute another agent's decisions to this
// one. Showing less is the rule; inventing attribution is not an option.

import type { ShapeGraph, ShapeNodeState, ShapeRow, ShapeStage } from "./shape-projection";

/** One governed tool call by this coworker, as the audit records it. */
export interface CoworkerToolCallRow {
  id: string;
  toolName: string;
  success: boolean;
  /** Audit classification, when the call was classified (nullable in the schema). */
  auditClass: string | null;
  createdAt: string | null;
}

export interface CoworkerShapeInput {
  agentId: string;
  /** True when the coworker is currently established/summonable. */
  established: boolean;
  toolCalls: CoworkerToolCallRow[];
  /**
   * Gate verdicts for this coworker, when a caller can supply them. Empty until
   * DecisionInteraction carries an acting-agent link — see the module note.
   */
  gateVerdicts?: ShapeRow[];
}

const STAGES = [
  { key: "establish", label: "Established" },
  { key: "act", label: "Governed action" },
  { key: "decide", label: "Decision gate" },
  { key: "verify", label: "Verify" },
  { key: "close", label: "Close" },
] as const;

function toolRow(call: CoworkerToolCallRow): ShapeRow {
  return {
    key: `tool:${call.id}`,
    label: call.toolName,
    // A failed governed call is a denial in the picture: it was attempted and
    // did not land. Success is a pass; nothing here is inferred.
    state: call.success ? "passed" : "denied",
    detail: call.auditClass ?? (call.success ? "ok" : "failed"),
    receiptRef: { table: "ToolExecution", id: call.id },
    actor: null,
  };
}

export function projectCoworkerShape(input: CoworkerShapeInput): ShapeGraph {
  const actRows = input.toolCalls.map(toolRow);
  const decideRows = input.gateVerdicts ?? [];

  const rowsByStage: Record<string, ShapeRow[]> = {
    establish: [{
      key: `establish:${input.agentId}`,
      label: input.established ? "Established" : "Draft",
      state: input.established ? "passed" : "holding",
      detail: input.established ? null : "not summonable",
      receiptRef: null,
      actor: null,
    }],
    act: actRows,
    decide: decideRows,
    verify: [],
    close: [],
  };

  const stages: ShapeStage[] = STAGES.map((stage) => {
    const rows = rowsByStage[stage.key] ?? [];
    let state: ShapeNodeState;
    if (rows.some((row) => row.state === "denied")) state = "denied";
    else if (rows.length === 0) state = "not-reached";
    else if (rows.every((row) => row.state === "passed")) state = "passed";
    else state = "holding";
    return {
      key: stage.key,
      label: stage.label,
      state,
      parallel: stage.key === "act" || stage.key === "decide",
      rows,
    };
  });

  const blocking = stages.find((s) => s.state === "denied")
    ?? stages.find((s) => s.state === "holding")
    ?? null;

  return {
    stages,
    blockingStageKey: blocking?.key ?? null,
    progress: {
      passed: stages.filter((s) => s.state === "passed").length,
      total: stages.length,
    },
  };
}
