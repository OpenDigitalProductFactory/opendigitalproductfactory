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
import type { JourneyResult, UnverifiableReason } from "./types";

export const JOURNEY_ISSUE_TYPE = "journey_failure" as const;
export const JOURNEY_UNVERIFIABLE_ISSUE_TYPE = "journey_unverifiable" as const;

/** What the operator is told, and what to do about it — per cause, in their
 *  language. The watchdog is the subject of these sentences, not the business:
 *  nothing here claims a journey is broken, because nothing was checked. */
const UNVERIFIABLE_COPY: Record<UnverifiableReason, string> = {
  "no-public-address":
    "Checks cannot run — this install has no public web address set, so the pages a customer would use cannot be opened.",
  "no-organization-slug":
    "Checks cannot run — this install has no organization address set, so customer-facing links cannot be built.",
};

/** Keyed by CAUSE, not by journey. Four journeys blocked by one missing setting
 *  are one thing for the operator to fix, so they collapse into one row instead
 *  of four copies of the same sentence. */
export function journeyUnverifiableIssueKey(reason: UnverifiableReason): string {
  return `journey-unverifiable:${reason}`;
}

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

/** Every reason, so reconcile can resolve the ones that no longer apply.
 *  Typed as the full union — adding a reason without handling it here is a
 *  compile error, not a row that silently never clears. */
export const UNVERIFIABLE_REASONS: readonly UnverifiableReason[] = [
  "no-public-address",
  "no-organization-slug",
] as const;

/**
 * Open or refresh the grouped "checks cannot run" row for one cause.
 *
 * Severity is `warn`, never `error`, and that is the point of this change: an
 * unconfigured address is a setup gap the operator can fix, not a business
 * outage. Four `error` rows saying "not working" about journeys nothing had
 * ever reached is the alert fatigue that stops an owner reading the surface at
 * all — which disarms the watchdog for the real outage it exists to catch.
 */
export async function openJourneyUnverifiableIssue(
  db: MonitorIssueDb,
  reason: UnverifiableReason,
  affected: readonly JourneyResult[],
  runId: string,
  now: () => Date = () => new Date(),
): Promise<string> {
  return openMonitorIssue(db, {
    issueKey: journeyUnverifiableIssueKey(reason),
    issueType: JOURNEY_UNVERIFIABLE_ISSUE_TYPE,
    severity: "warn",
    summary: UNVERIFIABLE_COPY[reason],
    details: {
      reason,
      runId,
      // Named so the operator can see what coverage they are losing, without
      // any of it being reported as broken.
      blockedJourneys: affected.map((j) => ({
        journeyId: j.journeyId,
        outcome: j.outcome,
        revenueBearing: j.revenueBearing,
      })),
      expected: affected[0]?.steps.find((s) => s.outcome === "unverifiable")?.expected ?? null,
      actual: affected[0]?.steps.find((s) => s.outcome === "unverifiable")?.actual ?? null,
    },
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
  // Cause → the journeys it blocked. Grouping happens here so the operator gets
  // one row per fix, not one per journey.
  const blocked = new Map<UnverifiableReason, JourneyResult[]>();

  for (const journey of journeys) {
    if (journey.status === "failed") {
      opened.push(await openJourneyFailureIssue(db, journey, runId, now));
      continue;
    }
    // Every non-failed journey clears its failure row — including unverifiable
    // ones. This is what retires the four false "not working" rows that a
    // previous build opened on evidence that never reached the business
    // (BI-04CC2090). The journey is NOT left silent: the grouped
    // journey_unverifiable row below carries it.
    await resolveJourneyFailureIssue(db, journey.journeyId, now);
    resolved.push(journeyIssueKey(journey.journeyId));

    if (journey.status === "unverifiable" && journey.unverifiableReason) {
      const forReason = blocked.get(journey.unverifiableReason) ?? [];
      forReason.push(journey);
      blocked.set(journey.unverifiableReason, forReason);
    }
  }

  for (const reason of UNVERIFIABLE_REASONS) {
    const affected = blocked.get(reason);
    if (affected && affected.length > 0) {
      opened.push(await openJourneyUnverifiableIssue(db, reason, affected, runId, now));
    } else {
      // The cause is gone — either it was fixed or those journeys stopped
      // applying. Either way the operator has nothing left to do about it.
      await resolveMonitorIssue(db, journeyUnverifiableIssueKey(reason), now);
      resolved.push(journeyUnverifiableIssueKey(reason));
    }
  }

  return { opened, resolved };
}
