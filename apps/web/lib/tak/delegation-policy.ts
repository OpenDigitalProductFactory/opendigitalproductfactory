// EP-27FD96BC · P4 (BI-8167C9CD) — delegation & altitude decision layer.
//
// The delegation PRIMITIVES all exist — request_coworker (hand to a named peer),
// spawn_work_thread / start_deliberation (fan out), and escalation — but nothing
// ever DECIDED among them: the model chose blindly, `hitlTierDefault` was inert
// metadata, and there was no policy relating a task's altitude to who should do
// it. So a coworker either flailed inline on work above its altitude or never
// delegated at all.
//
// This is the missing policy: it maps the per-turn effort/altitude signal (from
// the P1 effort warrant), the agent's human-oversight tier (`hitlTierDefault`),
// whether the task needs a capability the agent lacks, and whether it decomposes
// into independent parallel subtasks → one recommended mode. Pure and
// deterministic; the loop surfaces it as guidance so the coworker CHOOSES with a
// reason instead of guessing.

export type DelegationMode = "inline" | "request_coworker" | "fan_out" | "escalate";

export type DelegationEffort = "minimal" | "low" | "medium" | "high";

export interface DelegationSignals {
  /** The turn's effort/altitude level (from the EffortWarrant). */
  effortLevel: DelegationEffort;
  /** The agent's human-oversight tier: 1 = tight oversight … 3 = loose/autonomous. */
  hitlTier: number;
  /** The task needs a capability (grant/skill) this agent does not hold. */
  capabilityGap: boolean;
  /** The task splits into independent subtasks that can run in parallel. */
  decomposable: boolean;
  /** Current delegation-chain depth — caps runaway re-delegation. */
  delegationDepth: number;
}

export interface DelegationDecision {
  mode: DelegationMode;
  reason: string;
}

/** Never delegate past this chain depth — do it inline instead. */
export const MAX_DELEGATION_DEPTH = 3;

/**
 * Decide how a turn should be handled. Priority order (first match wins):
 *   1. depth cap    — at the chain limit, stop delegating; handle inline.
 *   2. escalate     — high-altitude work under tight human oversight (HITL 1).
 *   3. request peer — the task needs a capability this agent lacks.
 *   4. fan out      — high-effort AND decomposable → parallelize.
 *   5. inline       — within this agent's altitude and capability.
 * Pure.
 */
export function decideDelegation(signals: DelegationSignals): DelegationDecision {
  if (signals.delegationDepth >= MAX_DELEGATION_DEPTH) {
    return { mode: "inline", reason: "delegation-depth cap reached — handling inline" };
  }
  if (signals.hitlTier <= 1 && signals.effortLevel === "high") {
    return {
      mode: "escalate",
      reason: "high-altitude work under tight human oversight (HITL tier 1) — escalate to a human",
    };
  }
  if (signals.capabilityGap) {
    return {
      mode: "request_coworker",
      reason: "task needs a capability this agent lacks — hand to a capable peer",
    };
  }
  if (signals.effortLevel === "high" && signals.decomposable) {
    return {
      mode: "fan_out",
      reason: "high-effort decomposable task — fan out to parallel work threads",
    };
  }
  return { mode: "inline", reason: "within this agent's altitude and capability" };
}

const MODE_PRIMITIVE: Record<Exclude<DelegationMode, "inline">, string> = {
  escalate: "escalate to a human (ask the operator to decide/approve)",
  request_coworker: "call `request_coworker` to hand this to a peer that holds the capability",
  fan_out: "call `spawn_work_thread` (or `start_deliberation`) to run the parts in parallel",
};

/**
 * Render a one-block prompt hint from a decision, or null for `inline` (no hint —
 * the coworker just does the work). Pure. The coworker still makes the final call;
 * this names the recommended primitive and why.
 */
export function renderDelegationGuidance(decision: DelegationDecision): string | null {
  if (decision.mode === "inline") return null;
  return [
    "DELEGATION GUIDANCE:",
    `- Recommended: ${decision.mode} — ${decision.reason}.`,
    `- To act on it, ${MODE_PRIMITIVE[decision.mode]}.`,
    "- If your own read of the task disagrees, proceed as you judge best.",
  ].join("\n");
}
