// apps/web/lib/queue/functions/log-signature-scanner.ts
// EP-FULL-OBS Tier 2 (BI-5FE8656F) — novel-signature log scanner.
//
// Every 15 minutes: query Loki for error lines across all containers, cluster
// them into signatures, and file ONE PlatformIssueReport per NEW signature via
// the single PIR writer. Filing emits quality/issue-report.created, which
// projects the report into the backlog and (via auto-triage) into a tracked
// item — closing the "managed going forward" loop. The platform surfaces
// hidden log problems with no operator watching Docker Desktop.
//
// Mirrors token-expiry-monitor.ts exactly: a pure exported scan function (so
// tests drive it without the Inngest harness) + a thin wrapper with the
// quiescence gate. Idempotency is DB-backed via PlatformIssueReport.dedupeKey:
// an open report for a signature is never re-filed; a resolved one may re-file
// (the problem recurred — worth knowing).

import { cron } from "inngest";
import { inngest } from "../inngest-client";
import { gateAtEntry } from "../quiescence-gates";
import {
  clusterBySignature,
  dedupeKeyFor,
  severityForCount,
} from "@/lib/observability/log-signature";
import { queryLokiErrorLines } from "@/lib/observability/loki-query";

const LOOKBACK_MIN = Number(process.env.DPF_LOG_SCAN_LOOKBACK_MIN ?? 20);
// Only file for signatures seen at least this many times in the window. 1 =
// surface even a single novel occurrence (the silent-Qdrant case). Operators
// can raise it to reduce noise. No hard pin.
const MIN_COUNT = Number(process.env.DPF_LOG_SCAN_MIN_COUNT ?? 1);

// Statuses that mean "already resolved" — a signature in one of these is NOT
// considered an open duplicate, so a recurrence after resolution re-files.
const RESOLVED_STATUSES = ["resolved_locally", "resolved_upstream", "suppressed"];

export interface LogScanResult {
  scanned: number;
  signatures: number;
  reportsCreated: number;
  skippedExisting: number;
  lokiUnreachable?: boolean;
}

/**
 * The actual scan, exported separately so unit tests can drive it without the
 * Inngest harness (mirrors runTokenExpiryScan()).
 */
export async function runLogSignatureScan(opts?: {
  lookbackMinutes?: number;
}): Promise<LogScanResult> {
  const { prisma } = await import("@dpf/db");
  const { createPlatformIssueReport, accrueIssueReportOccurrence } = await import(
    "@/lib/quality/platform-issue-reports"
  );
  const lookbackMinutes = opts?.lookbackMinutes ?? LOOKBACK_MIN;

  let lines;
  try {
    lines = await queryLokiErrorLines({ lookbackMinutes });
  } catch (err) {
    // Loki not running (e.g. monitoring stack down) — do not fail the job, do
    // not create false reports. The next cycle retries.
    console.error("[log-signature-scanner] Loki unreachable; skipping scan", err);
    return { scanned: 0, signatures: 0, reportsCreated: 0, skippedExisting: 0, lokiUnreachable: true };
  }

  const buckets = clusterBySignature(lines).filter((b) => b.count >= MIN_COUNT);
  let reportsCreated = 0;
  let skippedExisting = 0;

  for (const b of buckets) {
    const dedupeKey = dedupeKeyFor(b.service, b.signatureId);

    // An unresolved report for this signature already exists: this is a
    // re-occurrence, not a novel signature. BI-51F6A428 — accrue it (bump
    // occurrenceCount + refresh lastSeenAt) instead of plain-skipping, so a
    // staged (below-reach-bar) signal advances toward promotion and the
    // aging-out sweep can tell it is still recurring. The triage cron promotes
    // it once it crosses the bar.
    const existing = await prisma.platformIssueReport.findFirst({
      where: { dedupeKey, status: { notIn: RESOLVED_STATUSES } },
      select: { id: true },
    });
    if (existing) {
      await accrueIssueReportOccurrence(existing.id);
      skippedExisting++;
      continue;
    }

    try {
      await createPlatformIssueReport({
        type: "log_signature",
        source: "log-signature-scanner",
        severity: severityForCount(b.count),
        dedupeKey,
        title: `New error signature in ${b.service}: ${b.sample.slice(0, 120)}`,
        description: [
          `Service: ${b.service}`,
          `Signature: ${b.signatureId}`,
          `Occurrences (last ${lookbackMinutes}m): ${b.count}`,
          `First seen: ${new Date(b.firstTs).toISOString()}`,
          `Last seen: ${new Date(b.lastTs).toISOString()}`,
          ``,
          `Template: ${b.template}`,
          ``,
          `Sample line:`,
          b.sample,
        ].join("\n"),
        routeContext: "/platform",
      });
      reportsCreated++;
    } catch (err) {
      // Partial-unique index on dedupeKey is the race backstop: a concurrent
      // run may have filed the same signature between our findFirst and create.
      if (err && typeof err === "object" && "code" in err && (err as { code?: string }).code === "P2002") {
        skippedExisting++;
        continue;
      }
      throw err;
    }
  }

  return { scanned: lines.length, signatures: buckets.length, reportsCreated, skippedExisting };
}

export const logSignatureScanner = inngest.createFunction(
  { id: "ops/log-signature-scanner", retries: 2, triggers: [cron("9,24,39,54 * * * *")] },
  async ({ step }) => {
    const gate = await gateAtEntry(step, "ops/log-signature-scanner");
    if (!gate.proceed) return { skipped: true, reason: gate.reason };

    return await step.run("scan-log-signatures", async () => runLogSignatureScan());
  },
);
