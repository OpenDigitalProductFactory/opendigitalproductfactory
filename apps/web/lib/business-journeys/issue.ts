// Journey failure → the operator's existing quality-issue inbox.
// Spec: docs/superpowers/specs/2026-07-28-critical-business-journey-watchdog-design.md §6
//
// One row per journey, keyed deterministically, so a journey that fails on
// Monday, Wednesday and Friday is ONE tracked issue rather than three. The
// contract registered in packages/db/src/quality-issue-registry.ts declares how
// it ends: the next passing run of the SAME journey resolves it.

import {
  openMonitorIssue,
  resolveMonitorIssue,
  type MonitorIssueDb,
  type MonitorIssueSeverity,
} from "@/lib/observability/monitor-issue-writer";
import { achievedDepth } from "./depth";
import type { JourneyResult } from "./types";

export const JOURNEY_ISSUE_TYPE = "journey_failure" as const;

/** Deterministic per-journey key. Stable across runs so the row is updated,
 *  never duplicated. */
export function journeyIssueKey(journeyId: string): string {
  return `journey-failure:${journeyId}`;
}

/** Revenue-bearing journeys are errors; the rest are warnings. The owner's
 *  inbox should not shout equally about every failure. */
function severityFor(journey: JourneyResult): MonitorIssueSeverity {
  return journey.revenueBearing ? "error" : "warn";
}

/**
 * Details payload the attention projection and the operator surface both read.
 * Carries the failing step with expected-vs-actual so the row is diagnosable
 * without re-running the sweep.
 */
export function journeyIssueDetails(journey: JourneyResult, runId: string) {
  const failed = journey.steps.filter((s) => s.outcome === "failed");
  return {
    journeyId: journey.journeyId,
    outcome: journey.outcome,
    businessImpact: journey.businessImpact,
    revenueBearing: journey.revenueBearing,
    runId,
    achievedDepth: achievedDepth(journey.steps),
    uncheckedDepths: journey.uncheckedDepths,
    failedSteps: failed.map((s) => ({
      stepId: s.stepId,
      label: s.label,
      depth: s.depth,
      detail: s.detail,
      expected: s.expected ?? null,
      actual: s.actual ?? null,
    })),
  };
}

/** Open or refresh the issue for a failing journey. */
export async function openJourneyFailureIssue(
  db: MonitorIssueDb,
  journey: JourneyResult,
  runId: string,
  now: () => Date = () => new Date(),
): Promise<string> {
  return openMonitorIssue(db, {
    issueKey: journeyIssueKey(journey.journeyId),
    issueType: JOURNEY_ISSUE_TYPE,
    severity: severityFor(journey),
    // The summary is what the owner reads first — state the lost outcome, not
    // the mechanism.
    summary: `${journey.outcome} — not working`,
    details: journeyIssueDetails(journey, runId),
    now,
  });
}

/** Resolve the issue for a journey that passed (or stopped applying). */
export async function resolveJourneyFailureIssue(
  db: MonitorIssueDb,
  journeyId: string,
  now: () => Date = () => new Date(),
): Promise<void> {
  await resolveMonitorIssue(db, journeyIssueKey(journeyId), now);
}

/**
 * Reconcile a whole sweep: every failing journey opens/refreshes its row, and
 * every journey that passed or no longer applies has its row resolved.
 *
 * Deliberately keyed off THIS sweep's journeys rather than a blanket
 * "resolve everything not in the active set": a journey that was removed from
 * the registry entirely should keep its row until an operator sees it, rather
 * than silently vanishing from the inbox.
 */
export async function reconcileJourneyIssues(
  db: MonitorIssueDb,
  journeys: readonly JourneyResult[],
  runId: string,
  now: () => Date = () => new Date(),
): Promise<{ opened: string[]; resolved: string[] }> {
  const opened: string[] = [];
  const resolved: string[] = [];
  for (const journey of journeys) {
    if (journey.status === "failed") {
      opened.push(await openJourneyFailureIssue(db, journey, runId, now));
    } else {
      await resolveJourneyFailureIssue(db, journey.journeyId, now);
      resolved.push(journeyIssueKey(journey.journeyId));
    }
  }
  return { opened, resolved };
}
