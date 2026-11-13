import type { InterpretableShape } from "../kernel/workroom/index.js";

export type RoomId = "customer-report" | "self-improvement";
type Practice = { key: string; version: string; objective: string; shape: InterpretableShape; assignments: Record<string, string>; humanStages: string[]; unavailable: string[] };
function shape(keys: readonly string[], reworkTarget: string): InterpretableShape {
  return {
    stages: keys.map(key => ({ key, advance: key === "verify" ? { kind: "governed-decision", gate: { mode: "enforced", blocking: true, onRefuse: reworkTarget } } : { kind: "status-change" } })),
    stopConditions: [{ kind: "success", disposition: "accepted" }, { kind: "budget", disposition: "awaiting-person" }],
    flow: { nodes: [], edges: [...keys.map((key, index) => ({ from: key, to: keys[index + 1] ?? "success" })), { from: "verify", to: reworkTarget, rework: { maxIterations: 1 } }] },
  };
}

/** Referenced fixture content, not an independently editable practice registry. */
export const practices: Record<RoomId, Practice> = {
  "customer-report": {
    key: "fixture.customer-report", version: "1.0.0", objective: "Accept a synthetic customer report enabled by a reviewed improvement",
    shape: shape(["inspect", "draft", "verify", "accept"], "draft"),
    assignments: { inspect: "coworker:operations", draft: "coworker:operations", verify: "coworker:reviewer", accept: "human:owner" }, humanStages: ["accept"],
    unavailable: ["real customer facts", "private corpus", "job qualification", "authenticated production principals", "customer communication"],
  },
  "self-improvement": {
    key: "fixture.self-improvement", version: "1.0.0", objective: "Accept a synthetic enabling improvement through independent review and bounded owner admission",
    shape: shape(["plan", "implement", "verify", "release"], "implement"),
    assignments: { plan: "coworker:engineer", implement: "coworker:engineer", verify: "coworker:reviewer", release: "human:owner" }, humanStages: ["release"],
    unavailable: ["code execution", "real software release", "skills/corpus adapters", "JSI assessment", "TAK enforcement", "general actor/session envelope aggregation"],
  },
};
