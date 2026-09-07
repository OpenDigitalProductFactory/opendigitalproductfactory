// BI-DA37A602 — Scheduled regulatory-monitor rescan (inngest).
//
// The compliance surface had exactly one path to a regulatory scan: the operator
// pressing "Run Scan Now" (triggerRegulatoryMonitorScan("manual")). Once run, it
// never refreshed — a scan that completed weeks ago kept reading as a current
// clean bill of health. The staleness treatment on the surface (scan-freshness.ts)
// now degrades an aged scan to "stale", but the honest end state is a scan that
// actually refreshes on a cadence.
//
// Regulations do not change hourly, so this runs weekly. Quiescence-gated (skips
// cleanly during a self-upgrade drain) and concurrency-limited to one in-flight
// run; the scan action carries its own "a scan is already running" guard as well.

import { cron } from "inngest";

import { inngest } from "../inngest-client";
import { gateAtEntry } from "../quiescence-gates";

/** Weekly, Monday 06:00 UTC. Regulations change on the order of months, not hours. */
export const REGULATORY_MONITOR_SCAN_CRON = "0 6 * * 1";
export const REGULATORY_MONITOR_SCAN_SCHEDULED_INNGEST_ID =
  "govern/regulatory-monitor-scan-scheduled";
export const REGULATORY_MONITOR_SCAN_REQUESTED_INNGEST_ID =
  "govern/regulatory-monitor-scan-requested";
/** Event the ops "run now" control dispatches to force an off-cadence rescan. */
export const REGULATORY_MONITOR_SCAN_REQUESTED_EVENT =
  "govern/regulatory-monitor-scan.requested";

async function runScheduledRegulatoryScan() {
  const { runRegulatoryMonitorScan } = await import(
    "@/lib/govern/regulatory-monitor-scan-run"
  );
  // "scheduled" skips the manage-compliance session check and records no operator
  // as the trigger — the runner handles a null session for this path. Imported
  // from the govern runner (not the actions layer) to respect the queue→actions
  // application boundary.
  return runRegulatoryMonitorScan("scheduled");
}

export const regulatoryMonitorScanScheduled = inngest.createFunction(
  {
    id: REGULATORY_MONITOR_SCAN_SCHEDULED_INNGEST_ID,
    retries: 1,
    // One scan at a time — a still-running scan must not overlap the next trigger.
    concurrency: { limit: 1, scope: "fn" },
    triggers: [cron(REGULATORY_MONITOR_SCAN_CRON)],
  },
  async ({ step }) => {
    const gate = await gateAtEntry(step, REGULATORY_MONITOR_SCAN_SCHEDULED_INNGEST_ID);
    if (!gate.proceed) return { skipped: true, reason: gate.reason };

    return step.run("regulatory-monitor-scan", runScheduledRegulatoryScan);
  },
);

// Operator "run now" — the ops scheduled-jobs surface dispatches
// REGULATORY_MONITOR_SCAN_REQUESTED_EVENT to force an off-cadence rescan.
export const regulatoryMonitorScanRequested = inngest.createFunction(
  {
    id: REGULATORY_MONITOR_SCAN_REQUESTED_INNGEST_ID,
    retries: 1,
    triggers: [{ event: REGULATORY_MONITOR_SCAN_REQUESTED_EVENT }],
  },
  async ({ step }) =>
    step.run("regulatory-monitor-scan-manual", runScheduledRegulatoryScan),
);
