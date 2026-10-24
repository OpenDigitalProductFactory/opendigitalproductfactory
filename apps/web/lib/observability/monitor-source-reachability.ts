// apps/web/lib/observability/monitor-source-reachability.ts
//
// One call for "my data source answered / did not answer this run" (BI-ADB574AB).
//
// Why this exists: three scheduled monitors independently computed their own
// source reachability and then threw it away — `log-signature-scanner` returned
// `lokiUnreachable`, `alert-delivery-bridge` returned `sourcesReached`, and
// `patch-assessment-sweep` swallowed an unreachable CISA KEV feed into an empty
// Set. In every case the job then reported a clean run. A monitor that cannot
// see is indistinguishable from a monitor that sees nothing wrong, which is the
// exact failure `make-silent-failures-observable` forbids.
//
// Deliberately NOT a new issue substrate: this composes the existing
// `monitor-clears` primitives in monitor-issue-writer.ts, so a blind monitor
// lands in the operator's existing PortfolioQualityIssue inbox and closes itself
// when the source comes back. The row is about the MONITOR, never the subject —
// see the `monitor_source_unreachable` contract in the quality-issue registry.

import {
  openMonitorIssue,
  resolveMonitorIssue,
  type MonitorIssueDb,
  type MonitorIssueSeverity,
} from "@/lib/observability/monitor-issue-writer";

export interface MonitorSourceReachabilityParams {
  /** The Inngest function id of the monitor, e.g. "ops/log-signature-scanner". */
  monitorId: string;
  /** The source it depends on, e.g. "loki", "cisa-kev", "prometheus". */
  sourceId: string;
  /** True when the source answered this run. */
  reached: boolean;
  /** What the operator loses while this source is dark. One line, plain. */
  blindTo: string;
  /** Error text when unreachable, for the issue details. */
  error?: unknown;
  severity?: MonitorIssueSeverity;
  now?: () => Date;
}

export function monitorSourceIssueKey(monitorId: string, sourceId: string): string {
  return `monitor-source-unreachable:${monitorId}:${sourceId}`;
}

/**
 * Record this run's reachability for one monitor/source pair. Opens an issue
 * when the source is dark, resolves it when the source answers. Idempotent, so
 * calling it every run is correct: a persistently-dark source refreshes one row
 * rather than accumulating.
 *
 * Never throws — a monitor must not lose its real work because the bookkeeping
 * write failed. A failure here is logged and swallowed, which is safe precisely
 * because the NEXT run re-asserts the same state.
 */
export async function recordMonitorSourceReachability(
  db: MonitorIssueDb,
  params: MonitorSourceReachabilityParams,
): Promise<void> {
  const issueKey = monitorSourceIssueKey(params.monitorId, params.sourceId);
  try {
    if (params.reached) {
      await resolveMonitorIssue(db, issueKey, params.now);
      return;
    }
    await openMonitorIssue(db, {
      issueKey,
      issueType: "monitor_source_unreachable",
      severity: params.severity ?? "warn",
      summary: `${params.monitorId} cannot reach ${params.sourceId} — ${params.blindTo}`,
      details: {
        monitorId: params.monitorId,
        sourceId: params.sourceId,
        blindTo: params.blindTo,
        error: params.error === undefined ? undefined : String(params.error).slice(0, 500),
      },
      now: params.now,
    });
  } catch (err) {
    console.error(
      `[monitor-source-reachability] could not record ${issueKey}; next run re-asserts`,
      err,
    );
  }
}
