/**
 * Automated upstream submission sweep (BI-96EFB042).
 *
 * Escalation already works — it has consent, a master pause, a mode check, rate
 * limiting, redaction and idempotency. What it lacked was a caller that is not a
 * human finger: the only two were a UI button and an MCP tool, both requiring
 * `manage_platform`. On an install running a rescue or a restaurant, nobody
 * holds that capability and nobody thinks to press the button, so problems
 * never reach the ecosystem.
 *
 * This sweep removes the need to REMEMBER. It does not remove the need to AGREE:
 * consent still gates every submission, and a install that has not opted in
 * produces one standing prompt rather than a stream of them.
 *
 * Pure planner — no Prisma, no fetch, no clock.
 */

import { ISSUE_REPORT_STATUS } from "@/lib/quality/issue-report-status";

/** States meaning "triaged here, and it is not just ours". */
const SUBMITTABLE_STATUSES = new Set<string>([
  ISSUE_REPORT_STATUS.TRIAGED_LOCAL,
  ISSUE_REPORT_STATUS.AWAITING_ESCALATION_ACK,
]);

export interface SweepableReport {
  id: string;
  status: string;
  upstreamIssueNumber: number | null;
  occurrenceCount: number;
}

export interface SweepConfig {
  /** Recorded consent for upstream feedback. */
  upstreamFeedbackOptIn: boolean;
  /** The master pause — overrides everything. */
  hiveContributionsPaused: boolean;
  contributionMode: string | null;
  /** This installation's declared purpose. */
  primaryPurpose: string | null;
}

export type SweepHalt =
  | { halted: true; reason: "paused"; message: string }
  | { halted: true; reason: "fork-only"; message: string }
  | { halted: true; reason: "awaiting-consent"; message: string; promptOperator: true }
  | { halted: true; reason: "not-applicable"; message: string };

export interface SweepPlan {
  halted: false;
  submit: string[];
  skipped: Array<{ id: string; reason: "already-filed" | "not-triaged" }>;
}

export type SweepOutcome = SweepPlan | SweepHalt;

/**
 * Decide what this sweep should submit.
 *
 * Fails CLOSED at every gate: any doubt halts the sweep rather than sending
 * something the install did not agree to release.
 */
export function planSubmissionSweep(input: {
  reports: SweepableReport[];
  config: SweepConfig;
}): SweepOutcome {
  const { config } = input;

  // A platform-development install files its own work directly; sweeping its
  // local reports upstream would loop them straight back to itself.
  if (config.primaryPurpose === "evolve-dpf") {
    return {
      halted: true,
      reason: "not-applicable",
      message: "this installation develops the platform and files its own work directly",
    };
  }

  if (config.hiveContributionsPaused) {
    return { halted: true, reason: "paused", message: "hive contributions are paused" };
  }

  if (config.contributionMode === "fork_only") {
    return { halted: true, reason: "fork-only", message: "contribution mode is fork_only" };
  }

  // One standing prompt, never one per report. A consent request repeated for
  // every defect is how a prompt gets permanently dismissed.
  if (!config.upstreamFeedbackOptIn) {
    return {
      halted: true,
      reason: "awaiting-consent",
      message: "upstream feedback has not been turned on for this installation",
      promptOperator: true,
    };
  }

  const submit: string[] = [];
  const skipped: SweepPlan["skipped"] = [];
  for (const report of input.reports) {
    if (report.upstreamIssueNumber !== null) {
      skipped.push({ id: report.id, reason: "already-filed" });
      continue;
    }
    if (!SUBMITTABLE_STATUSES.has(report.status)) {
      skipped.push({ id: report.id, reason: "not-triaged" });
      continue;
    }
    submit.push(report.id);
  }

  return { halted: false, submit, skipped };
}

export interface SweepResult {
  submitted: number;
  skipped: number;
  failed: number;
  halted: string | null;
}

export interface SweepRunnerDeps {
  plan: SweepOutcome;
  escalate: (reportId: string) => Promise<{ ok: boolean }>;
  onFailure?: (reportId: string, error: unknown) => void;
}

/**
 * Execute a plan.
 *
 * Fault-isolated per report: one failing escalation must not strand every
 * report after it — the same lesson the demand reconciliation loop learned.
 */
export async function runSubmissionSweep(deps: SweepRunnerDeps): Promise<SweepResult> {
  if (deps.plan.halted) {
    return { submitted: 0, skipped: 0, failed: 0, halted: deps.plan.reason };
  }

  let submitted = 0;
  let failed = 0;
  for (const reportId of deps.plan.submit) {
    try {
      const result = await deps.escalate(reportId);
      if (result.ok) submitted++;
      else failed++;
    } catch (err) {
      failed++;
      deps.onFailure?.(reportId, err);
    }
  }

  return { submitted, skipped: deps.plan.skipped.length, failed, halted: null };
}
