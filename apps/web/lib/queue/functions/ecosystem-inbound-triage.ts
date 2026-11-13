import type { JobStepTools } from "@/lib/jobs/types";
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
  // Retain compatibility with durable results written before source reconciliation.
  const recurred = Math.max(0, result.deduped - unchanged - changed);
  const allReviews = result.reviews ?? [];
  const reviews = allReviews
    .slice(0, 10)
    .map((review) => `${review.origin} (${review.candidates.join(", ") || "no candidates"})`)
    .join("; ") + (allReviews.length > 10 ? `; +${allReviews.length - 10} more` : "");
  return `${result.complete ? "Complete" : "Incomplete"} scan: ${result.ingested} created, ${unchanged} unchanged, `
    + `${changed} changed, ${recurred} recurred, ${needsReview} needs review, ${result.failed} failed; `
    + `${result.sourceErrors.length} unread source(s).${summarizeSecurity(result)}${reviews ? ` Needs review: ${reviews}.` : ""}`;
}

const SECURITY_SURFACE_LABELS = [
  ["dependabot-package", "Dependabot"], ["code-scanning-rule", "code scanning"], ["secret-scanning-alert", "secret scanning"],
] as const;

/** Per-surface counts, so an unreadable surface reads as unreadable, never as zero (BI-C67E5CCB). */
export function summarizeSecurity(result: RanOutcome): string {
  const security = result.security;
  if (!security) return "";
  const surfaces = SECURITY_SURFACE_LABELS.map(([kind, label]) => {
    const counts = security.surfaces[kind];
    return counts ? `${label} ${counts.alerts} alert(s) in ${counts.groups} item(s)` : `${label} UNREADABLE`;
  }).join("; ");
  const life = security.lifecycle;
  const moves = life
    ? ` Resolved ${life.resolved.length}, held by build ${life.heldByBuild.length}, reopened ${life.reopened.length}, `
      + `regressions ${life.regressions.length}${life.regressions.length ? ` (${life.regressions.slice(0, 10).join(", ")})` : ""}, `
      + `reprioritised ${life.reprioritized.length}.`
    : "";
  return ` Security: ${surfaces}.${moves}`;
}

async function recordScanOutcome(result: InboundTriageOutcome, arbitration: string | null = null): Promise<void> {
  const { prisma } = await import("@dpf/db");
  const entry = ECOSYSTEM_JOB_CATALOG_ENTRIES.find((job) => job.jobId === "ecosystem-inbound-issue-triage")!;
  const now = new Date();
  // The trigger below is fixed in code, so the catalog cron is the only true
  // schedule. A stored value could only go stale (BI-78C6646C): refresh it on
  // every heartbeat so the register and nextRunAt show what actually runs.
  const schedule = entry.cron!;
  const errors = result.ran ? result.sourceErrors.map(({ source, error }) => `${source}: ${error}`) : [];
  if (result.ran && result.failed > 0) errors.push(`${result.failed} item(s) failed ingestion`);
  if (result.ran && result.needsReview > 0) errors.push(`${result.needsReview} source identities need review`);
  const heartbeat = {
    lastRunAt: now,
    nextRunAt: projectNextRun(schedule, now),
    lastStatus: !result.ran ? "not-configured" : result.complete ? "completed" : "failed",
    lastError: errors.length ? errors.join("; ").slice(0, 2000) : null,
    lastRunSummary: (result.ran ? `${summarizeScan(result)}${arbitration ? ` ${arbitration}` : ""}` : result.reason).slice(0, 4000),
    ...(result.ran && result.issueReadComplete && result.scannedAt ? { runCursor: result.scannedAt } : {}),
  };
  await prisma.scheduledJob.upsert({
    where: { jobId: entry.jobId },
    create: { jobId: entry.jobId, name: entry.name, schedule, ...heartbeat },
    update: { schedule, ...heartbeat },
  });
}

/** Rank the open ecosystem queue and answer submitters on real decisions.
 *  Best-effort: a failure here is reported on the schedule view, never allowed
 *  to lose the intake scan's own heartbeat. */
async function arbitrateEcosystemQueue(): Promise<string> {
  try {
    const { prisma } = await import("@dpf/db");
    const {
      runEcosystemArbitrationCycle, sendEcosystemDecisionNotices, summarizeArbitration,
    } = await import("@/lib/ecosystem/arbitration-cycle");
    const { queueFounderDispositionNotices } = await import("@/lib/federation/demand-disposition");
    const { decodeDemandMirrorPayload } = await import("@/lib/federation/demand-exchange");
    const ranking = await runEcosystemArbitrationCycle(prisma as never);
    const decisions = await sendEcosystemDecisionNotices(prisma as never, {
      queue: (input) => queueFounderDispositionNotices(prisma as never, input),
      decodeEnvelope: (payload) => {
        const envelope = decodeDemandMirrorPayload(payload)?.envelope as
          { envelopeId?: unknown; originInstallationId?: unknown } | undefined;
        return typeof envelope?.envelopeId === "string" && typeof envelope.originInstallationId === "string"
          ? { envelopeId: envelope.envelopeId, originInstallationId: envelope.originInstallationId }
          : null;
      },
    });
    return summarizeArbitration(ranking, decisions);
  } catch (error) {
    const { getErrorMessage } = await import("@/lib/shared/get-error-message");
    return `Ecosystem queue not ranked: ${getErrorMessage(error)}`.slice(0, 500);
  }
}

// BI-F47386ED — the inbound half of the ecosystem loop. Until this existed the
// platform could only POST an issue upstream; nothing ever read one back, so a
// platform-development install could not see what the ecosystem had submitted.
//
// Every four hours: the owner-ratified detection target (spec §6.1). No-ops
// ("not commissioned") unless this install holds the verified repository-
// controller commission (BI-FD40397B, spec §6.1). Concurrency 1 is the local
// single-run protection: a cron fire and a retry never scan concurrently.
const intakeConcurrency = { limit: 1, scope: "account" as const, key: "'ecosystem-inbound-intake'" };

async function executeIntake({ step }: { step: JobStepTools }) {
    const result = await step.run("triage-inbound-ecosystem-items", async () => {
      const { runEcosystemInboundTriage } = await import("@/lib/ecosystem/inbound-triage-runner");
      return runEcosystemInboundTriage();
    });
    // BI-FB03E2FD — only a commissioned controller ranks the queue and answers
    // submitters; on any other install the intake did not run.
    const arbitration = result.ran
      ? await step.run("arbitrate-ecosystem-queue", () => arbitrateEcosystemQueue())
      : null;
    await step.run("record-inbound-scan-outcome", () => recordScanOutcome(result, arbitration));
    return result;
}

export const ecosystemInboundTriage = jobs.createFunction(
  { id: "ecosystem/inbound-issue-triage", retries: 2, concurrency: intakeConcurrency,
    triggers: [cron("17 */4 * * *")] },
  async ({ step }) => {
    const gate = await gateAtEntry(step, "ecosystem/inbound-issue-triage");
    if (!gate.proceed) return { skipped: true, reason: gate.reason };
    return executeIntake({ step });
  },
);

/** Explicit Run now uses the existing event rail, commission and shared lane. */
export const ecosystemInboundTriageRequested = jobs.createFunction(
  { id: "ecosystem/inbound-issue-triage-requested", retries: 2, concurrency: intakeConcurrency,
    triggers: [{ event: "ecosystem/inbound-issue-triage.requested" }] },
  async ({ step }) => {
    const gate = await gateAtEntry(step, "ecosystem/inbound-issue-triage-requested");
    if (!gate.proceed) return { skipped: true, reason: gate.reason };
    return executeIntake({ step });
  },
);
