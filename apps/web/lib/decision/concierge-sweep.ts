// The sweep that makes the queue come to the owner (BI-C62127B9, EP-0AF96937).
//
// This is the caller the panel has been waiting for. On a cadence it reads the
// decisions still waiting on a human, spends a bounded number of panels on the
// most consequential ones, and leaves a drafted resolution the owner can rule
// on in one place.
//
// Two rules make it safe to run unattended:
//
//   1. It is BOUNDED and says what it dropped. A cap that silently truncates
//      reads as "everything was covered" the moment anyone looks at the log, so
//      every skipped decision is counted and reported.
//   2. It NEVER decides anything. It convenes panels and writes proposals; the
//      proposals sit at `proposed` until a human rules. A sweep that could
//      resolve a decision on its own would be the thing this entire feature
//      exists to avoid.
//
// The heavy lifting is injected so the ordering, the caps and the reporting are
// testable without a provider, a queue, or a database.
//
// Spec: docs/superpowers/specs/2026-08-23-decision-concierge-design.md §4.6

import type { ConductorOutcome, TriageSubject } from "./triage-conductor";

/* -------------------------------------------------------------------------- */
/* Shapes                                                                     */
/* -------------------------------------------------------------------------- */

export type SweepLimits = {
  /** How many panels one pass may spend. */
  maxPanels: number;
};

export const DEFAULT_SWEEP_LIMITS: SweepLimits = { maxPanels: 5 };

export type SweepDeps = {
  /** Panel candidates, already filtered to the open + unproposed set. */
  candidates(): Promise<TriageSubject[]>;
  /** Run one decision through staffing, panel, contract and proposal. */
  conduct(subject: TriageSubject): Promise<ConductorOutcome>;
  /** Retire drafts whose decision was settled some other way. */
  retireStale(): Promise<number>;
  /** Record what the pass did, for the room and the operator log. */
  report(summary: SweepSummary): Promise<void>;
};

export type SweepSummary = {
  considered: number;
  panelled: number;
  proposed: number;
  /** Considered but not panelled because the cap was reached. */
  deferredToNextPass: number;
  /** Panelled but produced no proposal, by reason. */
  unproductive: Record<string, number>;
  retiredStaleProposals: number;
  /** Plain sentence for the room digest. */
  headline: string;
};

/* -------------------------------------------------------------------------- */
/* Ordering                                                                   */
/* -------------------------------------------------------------------------- */

const RISK_ORDER: Record<string, number> = { critical: 0, high: 1, medium: 2 };

/**
 * Highest risk first, then oldest — the decision most likely to be holding
 * something up gets the panel, and a long-ignored one is not starved forever by
 * a stream of newer arrivals.
 */
export function orderCandidates(candidates: readonly TriageSubject[]): TriageSubject[] {
  return [...candidates].sort((a, b) => {
    const risk = (RISK_ORDER[a.riskTier ?? ""] ?? 9) - (RISK_ORDER[b.riskTier ?? ""] ?? 9);
    if (risk !== 0) return risk;
    return a.interactionId.localeCompare(b.interactionId);
  });
}

/* -------------------------------------------------------------------------- */
/* Reporting                                                                  */
/* -------------------------------------------------------------------------- */

function buildHeadline(summary: Omit<SweepSummary, "headline">): string {
  if (summary.considered === 0) return "Nothing was waiting on you.";

  const parts: string[] = [];
  parts.push(
    summary.proposed === 1
      ? "Drafted an answer for 1 decision waiting on you."
      : `Drafted answers for ${summary.proposed} decisions waiting on you.`,
  );
  if (summary.proposed === 0) {
    parts[0] = `Looked at ${summary.panelled} decision(s) and could not draft an answer for any of them.`;
  }
  if (summary.deferredToNextPass > 0) {
    parts.push(`${summary.deferredToNextPass} more are queued for the next pass.`);
  }
  const unproductive = Object.entries(summary.unproductive)
    .filter(([, count]) => count > 0)
    .map(([reason, count]) => `${count} ${reason.replace(/-/g, " ")}`);
  if (unproductive.length > 0) parts.push(`No draft for: ${unproductive.join(", ")}.`);
  return parts.join(" ");
}

/* -------------------------------------------------------------------------- */
/* The pass                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * One sweep pass. Returns what it did rather than logging and forgetting, so
 * the caller can post it into the governance room and an operator can read the
 * same numbers the sweep acted on.
 */
export async function runConciergeSweep(
  deps: SweepDeps,
  limits: SweepLimits = DEFAULT_SWEEP_LIMITS,
): Promise<SweepSummary> {
  // Retire first: a draft whose decision was already settled must not be
  // counted as covered work, and must not block a fresh panel for a decision
  // that came back.
  const retiredStaleProposals = await deps.retireStale();

  const ordered = orderCandidates(await deps.candidates());
  const budgeted = ordered.slice(0, Math.max(0, limits.maxPanels));

  let proposed = 0;
  const unproductive: Record<string, number> = {};

  for (const subject of budgeted) {
    const outcome = await deps.conduct(subject);
    if (outcome.status === "proposed") {
      proposed += 1;
      continue;
    }
    unproductive[outcome.status] = (unproductive[outcome.status] ?? 0) + 1;
  }

  const base = {
    considered: ordered.length,
    panelled: budgeted.length,
    proposed,
    deferredToNextPass: Math.max(0, ordered.length - budgeted.length),
    unproductive,
    retiredStaleProposals,
  };
  const summary: SweepSummary = { ...base, headline: buildHeadline(base) };
  await deps.report(summary);
  return summary;
}
