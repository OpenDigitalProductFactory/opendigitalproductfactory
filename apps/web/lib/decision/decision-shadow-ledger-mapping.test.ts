import { describe, expect, it } from "vitest";

import { riskTierToRiskClass } from "@/lib/demand/funding-risk";
import { DECISION_DOMAIN_CLASSES, DECISION_RISK_TIERS } from "@/lib/decision-perspective/types";

import {
  DECISION_ACTIVITY_TYPES,
  DECISION_RISK_CLASSES,
  buildDecisionShadowLedgerEntry,
  decisionShadowLedgerId,
  mapDecisionTrustKey,
  type BridgeableDecisionRow,
} from "./decision-shadow-ledger-mapping";

function row(overrides: Partial<BridgeableDecisionRow> = {}): BridgeableDecisionRow {
  return {
    interactionId: "DI-ABC123",
    agentId: "AGT-WS-EA",
    domainClass: "kernel-consult",
    riskTier: "low",
    outcomeType: "recommend",
    recommendedOptionId: "a",
    options: ["a", "b"],
    rationale: "a keeps one source of truth",
    chosenOptionId: null,
    humanOutcome: null,
    taskRunId: null,
    autonomous: false,
    subjectKind: null,
    subjectRef: null,
    ...overrides,
  };
}

function resolution(overrides: Record<string, unknown> = {}) {
  return {
    type: "kernel-consult-resolution",
    disposition: "followed",
    resolvedBy: "agent",
    recommendedOptionId: "a",
    chosenOptionId: "a",
    agreement: true,
    rationale: "followed",
    resolvedAt: "2026-10-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("domain-class to activity-type mapping", () => {
  it("names every decision domain class explicitly, one activity type each", () => {
    expect(Object.keys(DECISION_ACTIVITY_TYPES).sort()).toEqual([...DECISION_DOMAIN_CLASSES].sort());
    const activityTypes = Object.values(DECISION_ACTIVITY_TYPES);
    // Distinct: two domain classes collapsing onto one activity would pool two
    // kinds of trust into one rate.
    expect(new Set(activityTypes).size).toBe(activityTypes.length);
  });

  it("states the mapping verbatim, so a change to it is a reviewed diff", () => {
    expect(DECISION_ACTIVITY_TYPES).toEqual({
      "plan-readiness": "governed_decision_plan_readiness",
      "architecture-tradeoff": "governed_decision_architecture_tradeoff",
      "risk-assessment": "governed_decision_risk_assessment",
      "professional-practice": "governed_decision_professional_practice",
      "kernel-consult": "governed_decision_kernel_consult",
    });
  });
});

describe("risk-tier to risk-class mapping", () => {
  it("names every decision risk tier explicitly", () => {
    expect(Object.keys(DECISION_RISK_CLASSES).sort()).toEqual([...DECISION_RISK_TIERS].sort());
    expect(DECISION_RISK_CLASSES).toEqual({
      low: "internal-reversible",
      medium: "internal-irreversible",
      high: "outbound-or-floor",
      critical: "outbound-or-floor",
    });
  });

  it("agrees with the funding gate on every tier the two vocabularies share", () => {
    // Two vocabularies that nearly agree is how parallel scope vocabularies
    // start. Where they overlap they must say the same thing.
    for (const tier of ["low", "medium", "high"] as const) {
      expect(DECISION_RISK_CLASSES[tier]).toBe(riskTierToRiskClass(tier));
    }
  });
});

describe("mapDecisionTrustKey", () => {
  it("maps a known domain class and risk tier", () => {
    expect(mapDecisionTrustKey("architecture-tradeoff", "high")).toEqual({
      mapped: true,
      activityType: "governed_decision_architecture_tradeoff",
      riskClass: "outbound-or-floor",
    });
  });

  it("refuses an unmapped domain class rather than guessing", () => {
    const result = mapDecisionTrustKey("billing-dispute", "low");
    expect(result).toMatchObject({ mapped: false, reason: "unmapped-domain-class" });
  });

  it("refuses an unmapped risk tier rather than guessing", () => {
    expect(mapDecisionTrustKey("kernel-consult", "severe")).toMatchObject({
      mapped: false,
      reason: "unmapped-risk-tier",
    });
  });

  it("is not fooled by inherited object keys", () => {
    expect(mapDecisionTrustKey("constructor", "low")).toMatchObject({ mapped: false, reason: "unmapped-domain-class" });
    expect(mapDecisionTrustKey("kernel-consult", "toString")).toMatchObject({
      mapped: false,
      reason: "unmapped-risk-tier",
    });
  });
});

describe("buildDecisionShadowLedgerEntry", () => {
  it("derives one deterministic ledger id per decision", () => {
    expect(decisionShadowLedgerId("DI-ABC123")).toBe("DSL-DI-ABC123");
    const first = buildDecisionShadowLedgerEntry(row());
    const second = buildDecisionShadowLedgerEntry(row());
    expect(first.built && second.built && first.entry.ledgerId === second.entry.ledgerId).toBe(true);
  });

  it("attributes an unresolved decision to its coworker at shadow, with agreement null", () => {
    const result = buildDecisionShadowLedgerEntry(row());
    expect(result.built).toBe(true);
    if (!result.built) return;
    expect(result.entry).toMatchObject({
      ledgerId: "DSL-DI-ABC123",
      agentId: "AGT-WS-EA",
      activityType: "governed_decision_kernel_consult",
      riskClass: "internal-reversible",
      autonomyLevel: "shadow",
      rationale: "a keeps one source of truth",
      sourceKind: "governed-decision",
      decisionInteractionId: "DI-ABC123",
      proposedDecision: {
        outcomeType: "recommend",
        recommendedOptionId: "a",
        options: ["a", "b"],
      },
      actualDecision: null,
      outcome: null,
      agreement: null,
      reconciledAt: null,
    });
  });

  it("collapses a dual-seed slug onto the canonical coworker identity", () => {
    const result = buildDecisionShadowLedgerEntry(row({ agentId: "build-specialist" }));
    expect(result.built && result.entry.agentId).toBe("AGT-WS-BUILD");
  });

  it("carries the actual decision, outcome and agreement once slice 1 knows the resolution", () => {
    const result = buildDecisionShadowLedgerEntry(
      row({ chosenOptionId: "b", humanOutcome: resolution({ disposition: "overridden", chosenOptionId: "b", agreement: false }) }),
    );
    expect(result.built).toBe(true);
    if (!result.built) return;
    expect(result.entry.actualDecision).toEqual({ chosenOptionId: "b", disposition: "overridden" });
    expect(result.entry.outcome).toEqual({
      disposition: "overridden",
      resolvedBy: "agent",
      resolvedAt: "2026-10-01T00:00:00.000Z",
    });
    expect(result.entry.agreement).toBe(false);
    expect(result.entry.reconciledAt).toEqual(new Date("2026-10-01T00:00:00.000Z"));
  });

  it("keeps agreement null for a reported-but-unresolved decision, never defaulting it", () => {
    const result = buildDecisionShadowLedgerEntry(
      row({ humanOutcome: resolution({ disposition: "unresolved", chosenOptionId: null, agreement: null }) }),
    );
    expect(result.built && result.entry.agreement).toBeNull();
    expect(result.built && result.entry.outcome).toMatchObject({ disposition: "unresolved" });
  });

  it("does not read agreement out of an outcome slice 1 did not write", () => {
    // An escalation answer or a work-pattern review is a different shape; it
    // says nothing about whether the kernel's pick was followed.
    const result = buildDecisionShadowLedgerEntry(
      row({ chosenOptionId: "a", humanOutcome: { type: "work-pattern-review", action: "approve", agreement: true } }),
    );
    expect(result.built && result.entry.agreement).toBeNull();
    expect(result.built && result.entry.actualDecision).toBeNull();
  });

  it("refuses a decision with no coworker rather than inventing one", () => {
    expect(buildDecisionShadowLedgerEntry(row({ agentId: null }))).toMatchObject({ built: false, reason: "no-agent" });
    expect(buildDecisionShadowLedgerEntry(row({ agentId: "  " }))).toMatchObject({ built: false, reason: "no-agent" });
  });

  it("refuses an unmapped domain class or risk tier", () => {
    expect(buildDecisionShadowLedgerEntry(row({ domainClass: "unknown" }))).toMatchObject({
      built: false,
      reason: "unmapped-domain-class",
    });
    expect(buildDecisionShadowLedgerEntry(row({ riskTier: "unknown" }))).toMatchObject({
      built: false,
      reason: "unmapped-risk-tier",
    });
  });

  it("records the source facts a later report needs to split the population", () => {
    const result = buildDecisionShadowLedgerEntry(
      row({
        autonomous: true,
        taskRunId: "TR-1",
        subjectKind: "backlog_item",
        subjectRef: "BI-1",
        humanOutcome: resolution({ resolvedBy: "human" }),
      }),
    );
    expect(result.built).toBe(true);
    if (!result.built) return;
    expect(result.entry.taskRunId).toBe("TR-1");
    expect(result.entry.metadata).toEqual({
      domainClass: "kernel-consult",
      riskTier: "low",
      autonomous: true,
      resolvedBy: "human",
      subject: { kind: "backlog_item", ref: "BI-1" },
    });
  });
});
