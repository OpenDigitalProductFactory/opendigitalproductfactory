// Governance ledger for the autonomous backlog-triage drain (BI-BB2E585C).
//
// The hourly ops/backlog-triage-drain cron asks a model to decide each item in
// the triaging queue and AUTO-APPLIES the confident build decisions: status →
// open, triageOutcome = build, effortSize. That is a consequential mutation of
// governed state, made by a model, running unattended every hour — and it wrote
// no DecisionInteraction row at all. An operator reviewing the decision log to
// ask "what is my AI workforce deciding?" saw none of it, which is worse than
// seeing nothing: the log looked like coverage.
//
// A note on the near-miss that hid this. The drain's routeAndCall passes
// `persistDecision: false`, which reads exactly like a governance opt-out and
// is not one — it suppresses RouteDecisionLog, the MODEL-ROUTING telemetry
// (which model/provider served the call). Governance persistence is
// DecisionInteraction, a different table on a different path, and nothing in
// this file's call graph ever touched it. Do not "fix" this by flipping that
// flag; it would add routing telemetry and still leave the ledger empty.
//
// Posture: fail-CLOSED. If the decision cannot be ledgered, the mutation does
// not happen and the item is left for a human. That inverts the usual fail-open
// ledger rule (see kernel-consult-ledger.ts, where a ledger outage must never
// block a decision the caller already made) because here the ledger write comes
// BEFORE the state change and is the only record that the change was governed.
// An unledgered auto-mutation is the exact defect being fixed; leaving an item
// in the triaging queue is the status quo ante and costs nothing.

import { MARK_DPF_PLATFORM_PROFILE } from "@/lib/decision-perspective/default-profile";
import { persistDecisionInteraction } from "@/lib/decision-perspective/persistence";
import type {
  DecisionPerspectiveEvaluationResult,
  DecisionRiskTier,
} from "@/lib/decision-perspective/types";
import type { TriageCandidate, TriageDecision } from "./backlog-triage-drain";

/** The gate key every triage-drain row carries. Tiers as WWMD. */
export const BACKLOG_TRIAGE_GATE_KEY = "backlog-triage";

export const TRIAGE_LEDGER_ROUTE_CONTEXT = "cron:ops/backlog-triage-drain";

type TriageLedgerClient = Parameters<typeof persistDecisionInteraction>[0]["db"] & {
  decisionPerspectiveProfileVersion: {
    findFirst(args: {
      where: Record<string, unknown>;
      orderBy?: Record<string, string>;
      select?: Record<string, boolean>;
    }): Promise<{ versionId: string } | null>;
  };
};

export type TriageLedgerOutcome =
  | { recorded: true; interactionId: string }
  | { recorded: false; reason: string };

/**
 * Risk tier for an auto-applied triage. Never "low": this is an unattended
 * mutation of governed state with no human in the loop at decision time. Larger
 * effort sizes commit proportionally more downstream work, so they escalate.
 */
export function triageRiskTier(effortSize: string): DecisionRiskTier {
  return effortSize === "large" || effortSize === "xlarge" ? "high" : "medium";
}

/**
 * Record an autonomous triage decision to the DecisionInteraction ledger.
 *
 * Returns `recorded: false` with a reason rather than throwing — the caller
 * treats that as "do not mutate", so a ledger failure degrades to the
 * pre-existing safe behaviour (item stays in the queue) instead of blowing up
 * the whole drain step.
 */
export async function recordTriageDecision(input: {
  db: TriageLedgerClient;
  item: TriageCandidate;
  decision: TriageDecision;
  /** The size actually being applied — may be the author's, not the model's. */
  appliedEffortSize: string;
  /** True when the applied size came from the author, not the model. */
  effortSizeFromAuthor: boolean;
}): Promise<TriageLedgerOutcome> {
  try {
    const profileId = MARK_DPF_PLATFORM_PROFILE.profileId;
    const version = await input.db.decisionPerspectiveProfileVersion.findFirst({
      where: { profileId },
      orderBy: { versionNumber: "desc" },
      select: { versionId: true },
    });
    if (!version) {
      // The platform profile is seeded on every install; if it is absent the
      // environment is not one where unattended mutation should be happening.
      console.warn(
        `[backlog-triage-ledger] platform profile "${profileId}" has no version row — refusing to auto-apply`,
      );
      return { recorded: false, reason: "profile-not-provisioned" };
    }

    const confidence = input.decision.confidence ?? 0;
    const evaluation: DecisionPerspectiveEvaluationResult = {
      // The drain only reaches this path for a confident build decision it is
      // about to apply, so the ledger records an arbitration, not advice.
      outcomeType: "arbitrate",
      selectedProfileId: profileId,
      fallbackProfileId: null,
      profileVersionId: version.versionId,
      confidenceBefore: confidence,
      confidenceAfter: confidence,
      confidenceScore: confidence,
      coverageGap: false,
      principleConflict: false,
      domainClass: "plan-readiness",
      resolvedProfileChain: [profileId],
      materialCount: 0,
      freshnessDistribution: { current: 0, stale: 0, superseded: 0, contradicted: 0 },
      riskTier: triageRiskTier(input.appliedEffortSize),
      question: `Triage ${input.item.itemId}: "${input.item.title}" — build, or leave for a human?`,
      options: ["build", "needs-human"],
      rationale: input.decision.rationale ?? "confident build",
      materialScores: [],
      sources: [],
    };

    const { interactionId } = await persistDecisionInteraction({
      db: input.db,
      build: null,
      evaluation,
      routeContext: TRIAGE_LEDGER_ROUTE_CONTEXT,
      phaseFrom: null,
      phaseTo: null,
      gateKey: BACKLOG_TRIAGE_GATE_KEY,
      gateFallbackUsed: false,
      outcomePayloadExtra: {
        // Names the unattended writer, so an operator scanning WWMD can tell
        // hourly cron triage from a human-initiated gate at a glance.
        callingSurface: TRIAGE_LEDGER_ROUTE_CONTEXT,
        autonomous: true,
        backlogItemId: input.item.itemId,
        recommendedOptionId: "build",
        mutationApplied: {
          status: "open",
          triageOutcome: "build",
          effortSize: input.appliedEffortSize,
        },
        effortSizeFromAuthor: input.effortSizeFromAuthor,
        modelProposedEffortSize: input.decision.effortSize ?? null,
      },
    });
    return { recorded: true, interactionId };
  } catch (error) {
    console.warn(
      `[backlog-triage-ledger] failed to record ${input.item.itemId} — refusing to auto-apply:`,
      error,
    );
    return { recorded: false, reason: "ledger-write-failed" };
  }
}
