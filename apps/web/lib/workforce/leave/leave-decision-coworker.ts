// D2.2 (BI-4D030159) — the leave-decisioning coworker orchestration.
//
// Threads the WWWD org-business-decision gate (the org's own staffing/leave
// doctrine — NOT the platform kernel) through the surface adapter and the D2.1
// hard safety guards, producing a propose-only recommendation. This module
// DECIDES what to recommend; it never mutates leave state — the actual approve/
// reject stays on D1's governed path (lib/actions/leave.ts).
//
// Order of authority: the hard guards are a PRE-FILTER. If any fires (coverage
// breach / overdrawn balance / consecutive-limit / blackout), the coworker
// escalates to the human approver and the org stance cannot change that: a hard
// operational constraint already dictates human review. The gate is still called
// once, declaring the rail as a crossed threshold, only so the decision reaching
// the manager carries a kernel record routed human by the BI-74B2A8CD rule table
// (BI-5CA6AB34). Only when the guards pass does the gate's stance decide.
//
// The org gate is injected (`deps.gate`) so this is unit-testable with no DB and
// no MCP: at runtime the caller passes `evaluateOrgBusinessDecisionGate`.

import type { DecisionDomainClass, DecisionRiskTier, DecisionScoredOption } from "@/lib/decision-perspective/types";
import {
  evaluateLeaveGuards,
  resolveLeaveDecision,
  type LeaveDecisionAction,
  type LeaveGuardInputs,
} from "./leave-decision-policy";
import { mapOrgDecisionToLeaveOutcome } from "./leave-decision-surface";

export type LeaveDecisionInputs = LeaveGuardInputs & {
  requestId: string;
  leaveType: string;
  organizationId: string | null;
};

/** The subset of `evaluateOrgBusinessDecisionGate` this orchestration depends on. */
export type OrgBusinessGateFn = (input: {
  db: unknown;
  organizationId: string | null | undefined;
  question: string;
  options: string[];
  scoredOptions?: DecisionScoredOption[];
  domainClass: DecisionDomainClass;
  riskTier: DecisionRiskTier;
  routeContext: string;
  declarations?: { thresholdExceeded?: boolean };
}) => Promise<{
  allowed: boolean;
  interactionId: string;
  orgProfileSelected: boolean;
  operatorMessage: string;
  evaluation: { outcomeType: string; recommendedOptionId?: string | null };
}>;

export type LeaveDecisionResult = {
  action: LeaveDecisionAction;
  /** WWWD ledger interaction, or null when a hard guard short-circuited to escalation. */
  interactionId: string | null;
  orgProfileSelected: boolean;
  operatorMessage: string;
  guardReasons: string[];
};

const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));

/**
 * Build the approve/deny option feature vectors for the WWWD gate. Features are
 * scored as "how much does this option exhibit this axis" (per dimension-catalog):
 * `business_disruption` (cost) rises as approving strains coverage;
 * `governance_compliance` (benefit) is high for the option that honors the
 * employee's entitlement + policy; `capacity_utilization` and `reversibility`
 * (benefits) favor deny. The org's own stance governs the outcome; these only
 * pick the argmax option within it.
 */
export function buildLeaveScoredOptions(inputs: LeaveGuardInputs): DecisionScoredOption[] {
  const headroom = inputs.coverage.coveredIfApproved - inputs.coverage.requiredHeadcount;
  const disruption = clamp01(1 - headroom / Math.max(1, inputs.coverage.requiredHeadcount));
  const withinBalance = inputs.requestedDays <= inputs.remainingBalance;

  return [
    {
      id: "approve",
      description: "Approve the leave request — honors the employee's entitlement and policy.",
      features: {
        governance_compliance: withinBalance ? 0.85 : 0.3,
        business_disruption: disruption,
        capacity_utilization: 0.3,
        reversibility: 0.3,
      },
    },
    {
      id: "deny",
      description: "Deny the leave request to keep the period staffed.",
      features: {
        governance_compliance: withinBalance ? 0.3 : 0.65,
        business_disruption: 0.05,
        capacity_utilization: 0.8,
        reversibility: 0.8,
      },
    },
  ];
}

/**
 * Produce a propose-only recommendation for a single leave request. Never
 * mutates state. Returns the resolved action (approve|deny|escalate), the WWWD
 * ledger interactionId (null if a guard short-circuited), and the guard reasons.
 */
export async function decideLeaveRequest(
  inputs: LeaveDecisionInputs,
  deps: { db: unknown; gate: OrgBusinessGateFn },
): Promise<LeaveDecisionResult> {
  const guards = evaluateLeaveGuards(inputs);

  const gateInput = {
    db: deps.db,
    organizationId: inputs.organizationId,
    question: `Should leave request ${inputs.requestId} (${inputs.requestedDays} day(s) of ${inputs.leaveType}) be approved or denied?`,
    options: ["approve", "deny"],
    scoredOptions: buildLeaveScoredOptions(inputs),
    domainClass: "risk-assessment" as const,
    riskTier: "low" as const,
    routeContext: "/coworker/leave-decision",
  };

  // Hard guards are a pre-filter: a fired rail forces human review whatever the
  // org stance says. The gate call only records that route (BI-5CA6AB34); if the
  // record cannot be made, the escalation still stands, without a record.
  if (guards.forceEscalate) {
    const recorded = await deps
      .gate({ ...gateInput, declarations: { thresholdExceeded: true } })
      .catch(() => null);
    return {
      action: "escalate",
      interactionId: recorded?.interactionId ?? null,
      orgProfileSelected: recorded?.orgProfileSelected ?? false,
      operatorMessage: `Escalated to a human approver: ${guards.reasons.join(" ")}`,
      guardReasons: guards.reasons,
    };
  }

  const gate = await deps.gate(gateInput);

  const outcome = mapOrgDecisionToLeaveOutcome({
    outcomeType: gate.evaluation.outcomeType,
    recommendedOptionId: gate.evaluation.recommendedOptionId,
    allowed: gate.allowed,
  });

  return {
    action: resolveLeaveDecision({ guards, decisionOutcome: outcome }),
    interactionId: gate.interactionId,
    orgProfileSelected: gate.orgProfileSelected,
    operatorMessage: gate.operatorMessage,
    guardReasons: guards.reasons,
  };
}
