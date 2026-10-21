import { cron } from "@/lib/jobs/triggers";
import { jobs } from "@/lib/jobs";
import { gateAtEntry } from "../quiescence-gates";
import type { InboundTriageOutcome } from "@/lib/ecosystem/inbound-triage-runner";
import { ECOSYSTEM_JOB_CATALOG_ENTRIES } from "@/lib/operate/scheduled-jobs/catalog-ecosystem";
import { projectNextRun } from "@/lib/operate/scheduled-jobs/cadence";

type RanOutcome = Extract<InboundTriageOutcome, { ran: true }>;

/** One line an operator reads on the schedule view (BI-952F08BA counts). */
function summarizeScan(result: RanOutcome): string {
  // `?? 0`: a durable step result memoized by an older build lacks these fields.
  const unchanged = result.unchanged ?? 0;
  const changed = result.changed ?? 0;
  const needsReview = result.needsReview ?? 0;
  // Non-reconciled origins (peer demand) still use recurrence semantics.
  const recurred = Math.max(0, result.deduped - unchanged - changed);
  const allReviews = result.reviews ?? [];
  const reviews = allReviews
    .slice(0, 10)
    .map((review) => `${review.origin} (${review.candidates.join(", ") || "no candidates"})`)
    .join("; ") + (allReviews.length > 10 ? `; +${allReviews.length - 10} more` : "");
  return `${result.complete ? "Complete" : "Incomplete"} scan: ${result.ingested} created, ${unchanged} unchanged, `
    + `${changed} changed, ${recurred} recurred, ${needsReview} needs review, ${result.failed} failed; `
    + `${result.sourceErrors.length} unread source(s).${reviews ? ` Needs review: ${reviews}.` : ""}`;
}

async function recordScanOutcome(result: InboundTriageOutcome): Promise<void> {
  const { prisma } = await import("@dpf/db");
  const entry = ECOSYSTEM_JOB_CATALOG_ENTRIES.find((job) => job.jobId === "ecosystem-inbound-issue-triage")!;
  const prior = await prisma.scheduledJob.findUnique({ where: { jobId: entry.jobId }, select: { schedule: true } });
  const now = new Date();
  const schedule = prior?.schedule ?? entry.cron!;
  const errors = result.ran ? result.sourceErrors.map(({ source, error }) => `${source}: ${error}`) : [];
  if (result.ran && result.failed > 0) errors.push(`${result.failed} item(s) failed ingestion`);
  const heartbeat = {
    lastRunAt: now,
    nextRunAt: projectNextRun(schedule, now),
    lastStatus: !result.ran ? "not-configured" : result.complete ? "completed" : "failed",
    lastError: errors.length ? errors.join("; ").slice(0, 2000) : null,
    lastRunSummary: result.ran ? summarizeScan(result) : result.reason,
  };
  await prisma.scheduledJob.upsert({
    where: { jobId: entry.jobId },
    create: { jobId: entry.jobId, name: entry.name, schedule, ...heartbeat },
    update: heartbeat,
  });
}

// BI-F47386ED — the inbound half of the ecosystem loop. Until this existed the
// platform could only POST an issue upstream; nothing ever read one back, so a
// platform-development install could not see what the ecosystem had submitted.
//
// Weekly, matching the ballot cadence in the ecosystem intake spec. No-ops
// ("not commissioned") unless this install holds the verified repository-
// controller commission (BI-FD40397B, spec §6.1). Concurrency 1 is the local
// single-run protection: a cron fire and a retry never scan concurrently.
export const ecosystemInboundTriage = jobs.createFunction(
  {
    id: "ecosystem/inbound-issue-triage",
    retries: 2,
    concurrency: { limit: 1, scope: "fn" },
    triggers: [cron("17 6 * * 1")],
  },
  async ({ step }) => {
    const gate = await gateAtEntry(step, "ecosystem/inbound-issue-triage");
    if (!gate.proceed) return { skipped: true, reason: gate.reason };

    const result = await step.run("triage-inbound-ecosystem-items", async () => {
      const { runEcosystemInboundTriage } = await import("@/lib/ecosystem/inbound-triage-runner");
      return runEcosystemInboundTriage();
    });
    // Separate durable step: retrying heartbeat persistence must not re-ingest
    // the already completed scan. Partial coverage is visible in the existing
    // schedule view without replaying a successful transport's records.
    await step.run("record-inbound-scan-outcome", () => recordScanOutcome(result));
    return result;
  },
);
