// BI-6082C235 (EP-DECISION-OUTCOME-LOOP slice 2). What a governed decision
// becomes in the shadow ledger.
//
// `DecisionShadowLedger` and `TrustState` key on agentId x activityType x
// riskClass. A `DecisionInteraction` speaks a different vocabulary:
// `domainClass` and `riskTier`. This module is the ONE place the two are
// translated, and it is pure so the translation can be stated and tested.
//
// Two vocabularies that nearly agree is how parallel scope vocabularies start,
// so the mapping is a closed, explicit table on both axes and an unmapped value
// is REFUSED. Guessing a bucket would quietly pool a decision into a trust rate
// it does not belong to.
//
// The ledger records only. It never authorizes anything: every row is written
// at `shadow`, and nothing here reads a trust level back.

import { resolveCanonicalAgentId } from "@dpf/db/agent-identity";

import type { RiskClass } from "@/lib/autonomy/trust-graduation";
import type { DecisionDomainClass, DecisionRiskTier } from "@/lib/decision-perspective/types";

import { readRecordedResolution, type DecisionDisposition, type DecisionResolver } from "./decision-outcome";

/**
 * One activity type per decision domain class. Namespaced so a governed
 * decision can never share a trust row with another ledger writer's activity
 * (`demand_bet_pickup`, a work-pattern activity key).
 */
export const DECISION_ACTIVITY_TYPES = {
  "plan-readiness": "governed_decision_plan_readiness",
  "architecture-tradeoff": "governed_decision_architecture_tradeoff",
  "risk-assessment": "governed_decision_risk_assessment",
  "professional-practice": "governed_decision_professional_practice",
  "kernel-consult": "governed_decision_kernel_consult",
} as const satisfies Record<DecisionDomainClass, string>;

/**
 * A decision's risk tier onto the reversibility buckets trust is earned in.
 * Agrees with the funding gate's `riskTierToRiskClass` on low/medium/high (the
 * tiers both vocabularies have); `critical` exists only here and sits on the
 * kernel floor, where a human always makes the call.
 */
export const DECISION_RISK_CLASSES = {
  low: "internal-reversible",
  medium: "internal-irreversible",
  high: "outbound-or-floor",
  critical: "outbound-or-floor",
} as const satisfies Record<DecisionRiskTier, RiskClass>;

/** The only level a bridged row is ever written at. */
export const DECISION_LEDGER_AUTONOMY_LEVEL = "shadow" as const;

/** Distinguishes bridged decisions from other ledger writers' evidence. */
export const DECISION_LEDGER_SOURCE_KIND = "governed-decision" as const;

export type DecisionTrustKeyRefusal = "unmapped-domain-class" | "unmapped-risk-tier";
export type DecisionLedgerRefusal = "no-agent" | DecisionTrustKeyRefusal;

export type DecisionTrustKey =
  | { mapped: true; activityType: string; riskClass: RiskClass }
  | { mapped: false; reason: DecisionTrustKeyRefusal; detail: string };

/**
 * Map the stored strings onto the trust key. The columns are free text in the
 * database, so this checks own keys only — `constructor` is not a domain class.
 */
export function mapDecisionTrustKey(domainClass: string, riskTier: string): DecisionTrustKey {
  if (!Object.hasOwn(DECISION_ACTIVITY_TYPES, domainClass)) {
    return {
      mapped: false,
      reason: "unmapped-domain-class",
      detail: `Decision domain class ${JSON.stringify(domainClass)} has no activity type. Add it to DECISION_ACTIVITY_TYPES deliberately rather than letting it fall into another bucket.`,
    };
  }
  if (!Object.hasOwn(DECISION_RISK_CLASSES, riskTier)) {
    return {
      mapped: false,
      reason: "unmapped-risk-tier",
      detail: `Decision risk tier ${JSON.stringify(riskTier)} has no risk class. Add it to DECISION_RISK_CLASSES deliberately rather than guessing its reversibility.`,
    };
  }
  return {
    mapped: true,
    activityType: DECISION_ACTIVITY_TYPES[domainClass as DecisionDomainClass],
    riskClass: DECISION_RISK_CLASSES[riskTier as DecisionRiskTier],
  };
}

/** The decision columns the bridge reads. Nothing else is consulted. */
export type BridgeableDecisionRow = {
  interactionId: string;
  agentId: string | null;
  domainClass: string;
  riskTier: string;
  outcomeType: string;
  recommendedOptionId: string | null;
  options: string[];
  rationale: string | null;
  chosenOptionId: string | null;
  humanOutcome: unknown;
  taskRunId: string | null;
  autonomous: boolean;
  subjectKind: string | null;
  subjectRef: string | null;
  /**
   * When the decision was made. Only a backfill of a decision that predates the
   * bridge passes it (BI-7D1E43DE), so its ledger row carries the decision's own
   * time rather than the time of the backfill. Live writes leave it to the
   * column default.
   */
  observedAt?: Date | null;
};

export type DecisionShadowLedgerEntry = {
  ledgerId: string;
  agentId: string;
  activityType: string;
  riskClass: RiskClass;
  autonomyLevel: typeof DECISION_LEDGER_AUTONOMY_LEVEL;
  proposedDecision: {
    outcomeType: string;
    recommendedOptionId: string | null;
    options: string[];
  };
  rationale: string | null;
  actualDecision: { chosenOptionId: string | null; disposition: DecisionDisposition } | null;
  outcome: { disposition: DecisionDisposition; resolvedBy: DecisionResolver; resolvedAt: string } | null;
  /** Null unless slice 1 recorded a resolution that carries one. Never defaulted. */
  agreement: boolean | null;
  reconciledAt: Date | null;
  sourceKind: typeof DECISION_LEDGER_SOURCE_KIND;
  /** Present only when the row supplied it; written on create, never updated. */
  observedAt?: Date;
  decisionInteractionId: string;
  taskRunId: string | null;
  metadata: {
    domainClass: string;
    riskTier: string;
    autonomous: boolean;
    resolvedBy: DecisionResolver | null;
    subject: { kind: string; ref: string } | null;
  };
};

export type DecisionShadowLedgerBuild =
  | { built: true; entry: DecisionShadowLedgerEntry }
  | { built: false; reason: DecisionLedgerRefusal; detail: string };

/**
 * Deterministic per decision. The ledger's unique `ledgerId` is what makes a
 * second write of the same decision an update of one row, never a second row.
 */
export function decisionShadowLedgerId(interactionId: string): string {
  return `DSL-${interactionId}`;
}

export function buildDecisionShadowLedgerEntry(row: BridgeableDecisionRow): DecisionShadowLedgerBuild {
  const rawAgentId = row.agentId?.trim() ?? "";
  if (!rawAgentId) {
    return {
      built: false,
      reason: "no-agent",
      detail: `Decision ${row.interactionId} names no coworker, so it cannot be attributed to one. A null agent is recorded as null, not invented.`,
    };
  }

  const key = mapDecisionTrustKey(row.domainClass, row.riskTier);
  if (!key.mapped) return { built: false, reason: key.reason, detail: key.detail };

  const resolution = readRecordedResolution(row.humanOutcome);

  return {
    built: true,
    entry: {
      ledgerId: decisionShadowLedgerId(row.interactionId),
      // Trust is per coworker. A dual-seed slug and its AGT-* twin are one
      // coworker, so they share one trust row.
      agentId: resolveCanonicalAgentId(rawAgentId),
      activityType: key.activityType,
      riskClass: key.riskClass,
      autonomyLevel: DECISION_LEDGER_AUTONOMY_LEVEL,
      proposedDecision: {
        outcomeType: row.outcomeType,
        recommendedOptionId: row.recommendedOptionId,
        options: row.options,
      },
      rationale: row.rationale,
      actualDecision: resolution
        ? { chosenOptionId: resolution.chosenOptionId, disposition: resolution.disposition }
        : null,
      outcome: resolution
        ? { disposition: resolution.disposition, resolvedBy: resolution.resolvedBy, resolvedAt: resolution.resolvedAt }
        : null,
      agreement: resolution ? resolution.agreement : null,
      reconciledAt: resolution ? new Date(resolution.resolvedAt) : null,
      sourceKind: DECISION_LEDGER_SOURCE_KIND,
      ...(row.observedAt ? { observedAt: row.observedAt } : {}),
      decisionInteractionId: row.interactionId,
      taskRunId: row.taskRunId,
      metadata: {
        domainClass: row.domainClass,
        riskTier: row.riskTier,
        autonomous: row.autonomous,
        resolvedBy: resolution?.resolvedBy ?? null,
        subject: row.subjectKind && row.subjectRef ? { kind: row.subjectKind, ref: row.subjectRef } : null,
      },
    },
  };
}
