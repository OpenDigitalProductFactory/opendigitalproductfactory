import type { AutonomyLevel } from "@/lib/autonomy/trust-graduation";
import type { BuildPrDeliveryStatus } from "@/lib/build/build-pr-delivery-state";
import type { DecisionOutcomeType } from "@/lib/decision-perspective/types";
import type { DeliverableSensitivity } from "@/lib/explore/build-process-matrix";

import { oneShotLaneDecision } from "./one-shot-lane";

export const AUTONOMOUS_BUILD_CHECKPOINTS = [
  "intake",
  "ideate",
  "plan",
  "build",
  "review",
  "ship",
  "pr",
  "release",
] as const;

export type AutonomousBuildCheckpoint =
  (typeof AUTONOMOUS_BUILD_CHECKPOINTS)[number];

export type AutonomousBuildNextAction =
  | "auto-start"
  | "continue"
  | "repair"
  | "decompose"
  | "ship"
  | "merge-queue"
  | "await-release"
  | "escalate";

export type AutonomousBuildAttribution = {
  bindingStatus: string;
  patternVersion: number;
  scopeMatches: boolean;
  evidenceFresh: boolean;
};

export type AutonomousBuildEligibilityInput = {
  checkpoint: AutonomousBuildCheckpoint;
  sensitivity: DeliverableSensitivity;
  workType?: string | null;
  effortSize?: string | null;
  gateOutcome: DecisionOutcomeType;
  oracles: "green" | "red" | "unavailable";
  attribution: AutonomousBuildAttribution | null;
  providerReady: boolean;
  sandboxState: "ready" | "drift" | "unavailable";
  regulatory: {
    ceiling: AutonomyLevel;
    humanControlRequired: boolean;
  };
  recoveryBudgetExhausted: boolean;
  deliveryStatus: BuildPrDeliveryStatus | null;
};

export type AutonomousBuildEligibility = {
  eligible: boolean;
  lane: "standard" | "one-shot";
  sensitivity: DeliverableSensitivity;
  activePatternVersion?: number;
  blockers: string[];
  nextGovernedAction: AutonomousBuildNextAction;
};

const CHECKPOINT_ACTION: Record<
  AutonomousBuildCheckpoint,
  AutonomousBuildNextAction
> = {
  intake: "auto-start",
  ideate: "continue",
  plan: "continue",
  build: "continue",
  review: "continue",
  ship: "ship",
  pr: "merge-queue",
  release: "await-release",
};

const ESCALATION_BLOCKERS = new Set([
  "recovery_budget_exhausted",
  "active_pattern_binding_missing",
  "active_pattern_binding_inactive",
  "active_pattern_scope_mismatch",
  "active_pattern_evidence_stale",
  "high_sensitivity_requires_human",
  "regulatory_ceiling_requires_human",
  "governance_gate_requires_human",
  "delivery_state_missing",
  "delivery_state_closed",
  "delivery_state_escalated",
  "delivery_state_not_merged",
]);

function deliveryBlocker(
  checkpoint: AutonomousBuildCheckpoint,
  deliveryStatus: BuildPrDeliveryStatus | null,
): string | null {
  if (checkpoint !== "pr" && checkpoint !== "release") return null;
  if (deliveryStatus === "closed") return "delivery_state_closed";
  if (deliveryStatus === "escalated") return "delivery_state_escalated";
  if (checkpoint === "pr") return null;
  if (deliveryStatus === null) return "delivery_state_missing";
  if (
    deliveryStatus === "created"
    || deliveryStatus === "checking"
    || deliveryStatus === "updating"
    || deliveryStatus === "queued"
  ) {
    return "delivery_state_not_merged";
  }
  return null;
}

/**
 * Pure, fail-closed projection of the evidence already owned by Build Studio.
 * It grants no authority and performs no writes. Callers must re-evaluate it
 * immediately before every consequential transition.
 */
export function evaluateAutonomousBuildEligibility(
  input: AutonomousBuildEligibilityInput,
): AutonomousBuildEligibility {
  const blockers: string[] = [];

  if (input.recoveryBudgetExhausted) {
    blockers.push("recovery_budget_exhausted");
  }
  if (!input.attribution) {
    blockers.push("active_pattern_binding_missing");
  } else {
    if (input.attribution.bindingStatus !== "active") {
      blockers.push("active_pattern_binding_inactive");
    }
    if (!input.attribution.scopeMatches) {
      blockers.push("active_pattern_scope_mismatch");
    }
    if (!input.attribution.evidenceFresh) {
      blockers.push("active_pattern_evidence_stale");
    }
  }
  if (input.sensitivity === "high") {
    blockers.push("high_sensitivity_requires_human");
  }
  if (
    input.regulatory.ceiling !== "autopilot"
    || input.regulatory.humanControlRequired
  ) {
    blockers.push("regulatory_ceiling_requires_human");
  }
  if (input.gateOutcome === "escalate" || input.gateOutcome === "defer") {
    blockers.push("governance_gate_requires_human");
  }
  if (!input.providerReady) {
    blockers.push("provider_unavailable");
  }
  const runtimeCheckpoint = [
    "build",
    "review",
    "ship",
  ].includes(input.checkpoint);
  if (runtimeCheckpoint) {
    if (input.sandboxState === "drift") {
      blockers.push("blocked_sandbox_drift");
    } else if (input.sandboxState === "unavailable") {
      blockers.push("sandbox_unavailable");
    }
  }
  const oracleCheckpoint = [
    "review",
    "ship",
    "pr",
    "release",
  ].includes(input.checkpoint);
  if (oracleCheckpoint && input.oracles === "unavailable") {
    blockers.push("oracles_unavailable");
  } else if (oracleCheckpoint && input.oracles === "red") {
    blockers.push("oracles_red");
  }
  const invalidDelivery = deliveryBlocker(
    input.checkpoint,
    input.deliveryStatus,
  );
  if (invalidDelivery) blockers.push(invalidDelivery);

  const lane = oneShotLaneDecision({
    workType: input.workType,
    effortSize: input.effortSize,
    sensitivity: input.sensitivity,
    gateOutcome: input.gateOutcome,
    oraclesGreen: input.oracles === "green",
  }).lane;
  const mustEscalate = blockers.some((blocker) =>
    ESCALATION_BLOCKERS.has(blocker),
  );
  const nextGovernedAction = mustEscalate
    ? "escalate"
    : blockers.length > 0
      ? "repair"
      : CHECKPOINT_ACTION[input.checkpoint];

  return {
    eligible: blockers.length === 0,
    lane,
    sensitivity: input.sensitivity,
    ...(input.attribution
      ? { activePatternVersion: input.attribution.patternVersion }
      : {}),
    blockers,
    nextGovernedAction,
  };
}
