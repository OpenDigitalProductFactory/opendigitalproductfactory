/**
 * Submission sweep runner (BI-96EFB042) — the impure edge.
 *
 * Loads config and eligible reports, plans, then escalates through the
 * UNCHANGED escalation core. Kept separate from the cron so the cron stays a
 * thin trigger and this stays callable from a tool or a test.
 */

import { getErrorMessage } from "@/lib/shared/get-error-message";
import { INSTALLATION_OPERATING_INTENT_KEY } from "@/lib/installation-journey/operating-intent";
import { ISSUE_REPORT_STATUS } from "@/lib/quality/issue-report-status";
import {
  planSubmissionSweep,
  runSubmissionSweep,
  type SweepConfig,
  type SweepResult,
  type SweepableReport,
} from "./submission-sweep";

export interface SubmissionSweepDeps {
  loadConfig?: () => Promise<SweepConfig>;
  loadReports?: () => Promise<SweepableReport[]>;
  escalate?: (reportId: string) => Promise<{ ok: boolean }>;
  /** How many triaged reports are waiting to go upstream. */
  countWaiting?: () => Promise<number>;
}

async function defaultLoadConfig(): Promise<SweepConfig> {
  const { prisma } = await import("@dpf/db");
  const [config, intent] = await Promise.all([
    prisma.platformDevConfig.findUnique({
      where: { id: "singleton" },
      select: {
        upstreamFeedbackOptIn: true,
        hiveContributionsPaused: true,
        contributionMode: true,
      },
    }),
    prisma.platformConfig.findUnique({
      where: { key: INSTALLATION_OPERATING_INTENT_KEY },
      select: { value: true },
    }),
  ]);
  const value = intent?.value as { primaryPurpose?: unknown } | null | undefined;
  return {
    upstreamFeedbackOptIn: config?.upstreamFeedbackOptIn ?? false,
    hiveContributionsPaused: config?.hiveContributionsPaused ?? false,
    contributionMode: config?.contributionMode ?? null,
    primaryPurpose: typeof value?.primaryPurpose === "string" ? value.primaryPurpose : null,
  };
}

const SUBMITTABLE = [ISSUE_REPORT_STATUS.TRIAGED_LOCAL, ISSUE_REPORT_STATUS.AWAITING_ESCALATION_ACK];

async function defaultCountWaiting(): Promise<number> {
  const { prisma } = await import("@dpf/db");
  return prisma.platformIssueReport.count({
    where: { upstreamIssueNumber: null, status: { in: SUBMITTABLE } },
  });
}

async function defaultLoadReports(): Promise<SweepableReport[]> {
  const { prisma } = await import("@dpf/db");
  return prisma.platformIssueReport.findMany({
    where: {
      upstreamIssueNumber: null,
      status: { in: SUBMITTABLE },
    },
    orderBy: { occurrenceCount: "desc" },
    // Bounded: the per-install rate limit is 30/hour, so a larger batch would
    // only manufacture refusals.
    take: 25,
    select: { id: true, status: true, upstreamIssueNumber: true, occurrenceCount: true },
  });
}

export async function runEcosystemSubmissionSweep(
  deps: SubmissionSweepDeps = {},
): Promise<SweepResult> {
  const config = await (deps.loadConfig ?? defaultLoadConfig)();

  // Load the reports themselves only once the gates could pass.
  const probe = planSubmissionSweep({ reports: [], config });
  if (probe.halted) {
    // BI-6ED89EC6: this branch used to end in a console line, so a sweep halted
    // for want of consent told nobody and halted again the next day. It now
    // reports how much is waiting; the heartbeat carries that to the register
    // and the attention source raises ONE standing item from it. Counting is a
    // local read — nothing leaves the installation to produce it.
    const waiting = probe.reason === "awaiting-consent"
      ? await (deps.countWaiting ?? defaultCountWaiting)().catch(() => null)
      : null;
    return { submitted: 0, skipped: 0, failed: 0, halted: probe.reason, waiting };
  }

  const reports = await (deps.loadReports ?? defaultLoadReports)();
  const escalate = deps.escalate ?? (async (reportId: string) => {
    const { escalateReportUpstream } = await import("@/lib/actions/feedback-escalation");
    const result = await escalateReportUpstream({ reportId });
    return { ok: result.ok };
  });

  return runSubmissionSweep({
    plan: planSubmissionSweep({ reports, config }),
    escalate,
    onFailure: (reportId, err) => {
      console.warn(`[ecosystem-submission-sweep] skipped ${reportId}: ${getErrorMessage(err)}`);
    },
  });
}
