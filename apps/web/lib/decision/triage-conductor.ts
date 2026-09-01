// Convening a governance-triage panel for one unresolved decision
// (BI-19B350FD, EP-0AF96937).
//
// This is the join between the three pieces that already exist: staffing
// (triage-staffing), the deliberation framework (the panel itself), and the
// proposal lifecycle (resolution-proposal-store). It owns the ORDER and the
// refusals; it owns none of the mechanics.
//
// Every exit is explicit, because the failure modes here are quiet ones:
//   - already-proposed  a draft is open for this decision; do not pile a second
//   - already-resolved  a human settled it while the panel was thinking
//   - not-worth-a-panel low risk, or nothing for a specialist to reason about
//   - panel-unavailable the run could not start (no provider, budget, outage)
//   - panel-inconclusive the run itself reported it could not ground an answer
//   - verdict-refused   the output failed the contract (triage-verdict)
//
// Only the last state on that list is a quality problem, and it is recorded
// with its reason rather than retried into a better-looking answer.
//
// The panel start is injected. Deliberation dispatch is asynchronous and
// provider-bound; keeping it behind a seam is what makes the ordering and the
// refusals testable without a live model.
//
// Spec: docs/superpowers/specs/2026-08-23-decision-concierge-design.md §4.3

import {
  createResolutionProposal,
  type ProposalClient,
} from "./resolution-proposal-store";
import {
  planTriageStaffing,
  resolveStaffedCoworkers,
  type RosterCandidate,
  type StaffingPlan,
} from "./triage-staffing";
import {
  admitTriageVerdict,
  panelReportedInsufficient,
  type TriageVerdict,
} from "./triage-verdict";

/* -------------------------------------------------------------------------- */
/* Shapes                                                                     */
/* -------------------------------------------------------------------------- */

/** The decision a panel is being convened for. */
export type TriageSubject = {
  /** DecisionInteraction row id. */
  interactionRowId: string;
  interactionId: string;
  profileId: string;
  question: string;
  domainClass: string | null;
  gateKey: string | null;
  professionKey?: string | null;
  riskTier: string | null;
  outcomeType: string;
  /** True once a human has settled it, however that happened. */
  resolved: boolean;
};

export type PanelResult = {
  deliberationRunId: string;
  consensusState: string | null;
  /** The adjudicator's output, unvalidated — this module admits it. */
  rawVerdict: unknown;
};

export type ConductorDeps = {
  /** Live coworkers this install can seat. */
  roster(): Promise<readonly RosterCandidate[]>;
  /** Start (and await) a governance-triage run. Null when it could not run. */
  runPanel(input: {
    subject: TriageSubject;
    plan: StaffingPlan;
    staffedAgentIds: string[];
  }): Promise<PanelResult | null>;
  db: ProposalClient;
};

export type ConductorOutcome =
  | { status: "proposed"; proposalId: string; verdict: TriageVerdict; uncovered: boolean }
  | {
    status:
    | "already-proposed"
    | "already-resolved"
    | "not-worth-a-panel"
    | "panel-unavailable"
    | "panel-inconclusive"
    | "verdict-refused";
    detail: string;
  };

/** Risk tiers that justify spending a panel. */
const PANEL_WORTHY_RISK = new Set(["medium", "high", "critical"]);

/* -------------------------------------------------------------------------- */
/* Eligibility (pure)                                                         */
/* -------------------------------------------------------------------------- */

export type Eligibility = { eligible: boolean; reason: string };

/**
 * Whether this decision should get a panel at all. Deliberately conservative:
 * a panel costs provider budget and produces the most persuasive artifact the
 * platform shows an owner, so it is spent on decisions that are actually
 * waiting and actually consequential.
 */
export function isPanelWorthy(subject: TriageSubject): Eligibility {
  if (subject.resolved) {
    return { eligible: false, reason: "A human has already settled this decision." };
  }
  if (subject.outcomeType !== "escalate" && subject.outcomeType !== "defer") {
    return { eligible: false, reason: "This decision was settled by the gate, not left to a human." };
  }
  if (subject.question.trim().length === 0) {
    return {
      eligible: false,
      reason: "The record carries no question, so there is nothing for a specialist to reason about.",
    };
  }
  if (!PANEL_WORTHY_RISK.has(subject.riskTier ?? "")) {
    return {
      eligible: false,
      reason: `Risk is ${subject.riskTier ?? "unrecorded"}; panels are spent on medium risk and above.`,
    };
  }
  return { eligible: true, reason: "Unresolved, consequential, and answerable." };
}

/* -------------------------------------------------------------------------- */
/* Conduct                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Run the whole sequence for one decision and return what happened. Writes at
 * most one proposal, and only from a verdict that passed the contract.
 */
export async function conductTriage(
  deps: ConductorDeps,
  subject: TriageSubject,
): Promise<ConductorOutcome> {
  const eligibility = isPanelWorthy(subject);
  if (!eligibility.eligible) {
    return {
      status: subject.resolved ? "already-resolved" : "not-worth-a-panel",
      detail: eligibility.reason,
    };
  }

  const plan = planTriageStaffing({
    domainClass: subject.domainClass,
    gateKey: subject.gateKey,
    professionKey: subject.professionKey ?? null,
    question: subject.question,
  });
  const { staffed } = resolveStaffedCoworkers(plan, await deps.roster());

  const panel = await deps.runPanel({
    subject,
    plan,
    staffedAgentIds: staffed.map((s) => s.agentId),
  });
  if (!panel) {
    return {
      status: "panel-unavailable",
      detail: "The panel could not be convened, so nothing was drafted.",
    };
  }

  // The run's own report of itself outranks its output: a run that says it
  // could not ground an answer and still returns a confident draft is
  // contradicting itself, and the report wins.
  if (panelReportedInsufficient(panel.consensusState)) {
    return {
      status: "panel-inconclusive",
      detail: "The panel could not ground a recommendation, so it drafted nothing.",
    };
  }

  const admission = admitTriageVerdict(panel.rawVerdict);
  if (!admission.admissible) {
    return { status: "verdict-refused", detail: admission.detail };
  }

  const created = await createResolutionProposal(deps.db, {
    scopeKind: "interaction",
    interactionId: subject.interactionRowId,
    profileId: subject.profileId,
    actionKind: admission.verdict.recommendedAction,
    draftPayload: admission.verdict.draft,
    summary: admission.verdict.summary,
    consequences: admission.verdict.consequences,
    dissent: admission.verdict.dissent,
    confidence: admission.verdict.confidence,
    deliberationRunId: panel.deliberationRunId,
  });

  if (!created.ok) {
    return {
      status: created.error === "already-ruled" ? "already-resolved" : "already-proposed",
      detail:
        created.error === "already-ruled"
          ? "A human ruled on this while the panel was running; their ruling stands."
          : "A drafted resolution is already open for this decision.",
    };
  }

  return {
    status: "proposed",
    proposalId: created.data.proposalId,
    verdict: admission.verdict,
    uncovered: plan.uncovered,
  };
}
