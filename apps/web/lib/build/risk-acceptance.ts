// apps/web/lib/build/risk-acceptance.ts
//
// BI-09FB398D: a residual risk that the failure analysis places outside this
// change cannot be coded away by the build's agent. Before this module every
// such risk ran the bounded repair loop to its end and reached the owner as
// needs-human (PIR-1O0W0: "Service crashes after accepting webhook but before
// queuing", FB-837ACE25). Five did so in one week.
//
// Commandment: escalation is a gate, not a trust tier. Each risk goes through
// the same seam as every owner hand-off (route-to-human.ts, BI-5E067004):
//   - damaging (a critical risk) -> a person, as before; nothing is accepted;
//   - WWMD decided, not damaging -> accepted for this change: the owning item is
//     filed as projected agent work and a Workroom authority records the
//     decision, which is what the failure-analysis validator resolves;
//   - anything the consult did not decide -> back on the bounded repair path.
// The model only says a risk lies outside the change. It never grants itself
// the acceptance; the validator still refuses any acceptance without an
// authority bound to this room, change and scenario.

import type { DecisionRiskTier } from "@/lib/decision-perspective/types";
import type { FailureAnalysisIdentity, FailureVerificationEvidence } from "@/lib/change-review/failure-analysis";
import type {
  OwnerAttentionDecision,
  OwnerAttentionFiled,
  OwnerAttentionInput,
  OwnerAttentionReport,
} from "@/lib/govern/authority/route-to-human";
import type { RiskAcceptanceOutcome, UnmitigatedRisk } from "./finalize-stage";

export type RiskAcceptanceRecordInput = {
  scenarioKey: string;
  identity: FailureAnalysisIdentity;
  followUpReference: string;
  /** The consult as recorded on the decision (scope, option, confidence, ledger id). */
  consult: string;
  /** The decision sentence the seam produced. */
  decision: string;
};

export type RiskAcceptanceDeps = {
  decide: (input: OwnerAttentionInput) => Promise<OwnerAttentionDecision>;
  file: (decision: OwnerAttentionDecision, report: OwnerAttentionReport) => Promise<OwnerAttentionFiled>;
  /** Writes the platform authority; returns its id, or null when it could not be written. */
  record: (input: RiskAcceptanceRecordInput) => Promise<{ id: string; completedAt: string } | null>;
};

/** A build stall's only damage signal is severity; critical is what the gate puts to a person. */
const RISK_TIER: Record<UnmitigatedRisk["severity"], DecisionRiskTier> = {
  low: "low", medium: "medium", high: "high", critical: "critical",
};

function consultLine(decision: OwnerAttentionDecision): string {
  const c = decision.consult;
  return [
    c.scope === "organization" ? "WWWD" : "WWMD",
    c.optionId ?? "no option",
    c.confidence ? `(${c.confidence})` : null,
    c.interactionId ?? null,
  ].filter(Boolean).join(" ");
}

export async function acceptOutOfScopeRisks(
  input: { buildId: string; buildPk: string; identity: FailureAnalysisIdentity; risks: readonly UnmitigatedRisk[] },
  deps: RiskAcceptanceDeps,
): Promise<RiskAcceptanceOutcome> {
  const outcome: RiskAcceptanceOutcome = { accepted: [], owner: [], unaccepted: [] };
  for (const risk of input.risks) {
    const fact = `[${risk.severity}] Risk ${risk.key} lies outside this change: ${risk.trigger} -> ${risk.effect}. ` +
      `Why it is not mitigated here: ${risk.rationale}`;
    const decision = await deps.decide({
      producer: "build-stall",
      subject: { kind: "build", id: input.buildId },
      blockingFacts: [fact],
      blockerClass: "unmitigated-risk",
      declarations: { riskTier: RISK_TIER[risk.severity] },
    });
    if (decision.route === "human") { outcome.owner.push(risk); continue; }
    if (decision.route !== "agent") { outcome.unaccepted.push(risk); continue; }

    // The owning item: projected agent work, never the owner's inbox.
    const filed = await deps.file(decision, {
      source: "build-studio",
      severity: risk.severity,
      title: `Risk outside ${input.buildId}'s change: ${risk.key}`.slice(0, 300),
      description:
        `${risk.trigger} -> ${risk.effect}.\n\nWhy build ${input.buildId} cannot mitigate it: ${risk.rationale}\n\n` +
        `The risk was accepted for that change (tree ${input.identity.headTreeHash}) so the build can proceed; ` +
        "this item owns the mitigation.",
      featureBuildId: input.buildPk,
      triggerKind: "out-of-scope-risk",
      dedupeKey: `out-of-scope-risk:${input.buildId}:${risk.key}`,
    });
    if (!filed.reportId) { outcome.unaccepted.push(risk); continue; }

    const consult = consultLine(decision);
    const recorded = await deps.record({
      scenarioKey: risk.key, identity: input.identity, followUpReference: filed.reportId,
      consult, decision: decision.reason,
    });
    if (!recorded) { outcome.unaccepted.push(risk); continue; }

    const authority: FailureVerificationEvidence = {
      id: recorded.id, kind: "risk-acceptance", ...input.identity, status: "accepted",
      expected: consult, observed: decision.reason, completedAt: recorded.completedAt,
      scenarioKey: risk.key, followUpReference: filed.reportId,
    };
    outcome.accepted.push({
      key: risk.key, authority, followUpReference: filed.reportId,
      note: `Accepted for this change under the escalation gate (${consult}); ${filed.reportId} owns the mitigation.`,
    });
  }
  return outcome;
}

/** The live dependencies: the seam's decision and write, and the Workroom log. */
export async function liveRiskAcceptanceDeps(workroomId: string): Promise<RiskAcceptanceDeps> {
  const [{ decideOwnerAttentionRoute, fileOwnerAttentionRoute }, { prisma }, { RISK_ACCEPTANCE_ACTIVITY_KIND }] = await Promise.all([
    import("@/lib/govern/authority/route-to-human"),
    import("@dpf/db"),
    import("@/lib/change-review/failure-analysis-evidence"),
  ]);
  return {
    decide: (input) => decideOwnerAttentionRoute(input),
    file: (decision, report) => fileOwnerAttentionRoute(decision, report),
    record: async (input) => {
      try {
        const row = await prisma.workroomActivity.create({
          data: {
            workCapsuleId: workroomId,
            kind: RISK_ACCEPTANCE_ACTIVITY_KIND,
            summary: `Risk ${input.scenarioKey} accepted for this change; ${input.followUpReference} owns it.`.slice(0, 500),
            payload: {
              scenarioKey: input.scenarioKey,
              headTreeHash: input.identity.headTreeHash,
              diffDigest: input.identity.diffDigest,
              followUpReference: input.followUpReference,
              consult: input.consult,
              decision: input.decision,
              backlogItem: "BI-09FB398D",
            },
          },
          select: { id: true, recordedAt: true },
        });
        return { id: row.id, completedAt: row.recordedAt.toISOString() };
      } catch {
        return null;
      }
    },
  };
}
