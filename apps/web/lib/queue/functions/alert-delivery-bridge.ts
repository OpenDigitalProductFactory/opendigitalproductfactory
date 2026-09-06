// apps/web/lib/queue/functions/alert-delivery-bridge.ts
// EP-FULL-OBS Tier 2 (BI-5FE8656F item #6) — alert-delivery bridge.
//
// The platform has no Alertmanager (deliberately — "minimize entirely new
// processes"), so firing Prometheus metric alerts and Loki ruler log-rate/storm
// alerts evaluate but never reach the operator. This cron closes that loop
// WITHOUT a new process: it reuses the existing inngest runtime (where the
// log-signature-scanner already lives), polls both evaluators' Prometheus-shaped
// alerts APIs, and upserts each FIRING alert into the same PortfolioQualityIssue
// inbox the rest of the platform's health alerts use — then resolves issues
// whose alert has cleared.
//
// Mirrors token-expiry-monitor / log-signature-scanner exactly: a pure exported
// scan function (driveable by tests without the Inngest harness) + a thin
// wrapper with the quiescence gate.
//
// Storm-proof by construction: it reads AGGREGATED alert state, so a container
// flooding 10k lines/sec yields exactly ONE ContainerErrorLogStorm issue, never
// a per-line flood. MAX_ALERTS_PER_CYCLE is a belt-and-suspenders cap.

import { cron } from "inngest";
import { inngest } from "../inngest-client";
import { gateAtEntry } from "../quiescence-gates";
import {
  fetchAlertSources,
  type AlertSourceSystem,
} from "@/lib/observability/alert-sources";
import { screenAlertsForSelfDistrust } from "@/lib/observability/alert-self-distrust";
import {
  upsertHealthAlertIssue,
  resolveHealthAlertIssue,
} from "@/lib/observability/health-alert-issue";
// NOT a static import. notify-live statically pulls in `prisma` and the agent
// event bus, and this module deliberately keeps @dpf/db out of module scope
// (see the dynamic `await import("@dpf/db")` in runAlertDeliveryScan). A static
// import here instantiates Prisma for every importer of this module — including
// lib/queue/functions/index.ts and anything that touches it — which killed the
// vitest run outright. Loaded lazily inside the scan instead.

// Defensive bound on issues touched per cycle. Real alert counts are tiny
// (rules x services); this only matters under a pathological fan-out. No hard
// pin — operator-tunable.
const MAX_ALERTS_PER_CYCLE = Number(process.env.DPF_ALERT_BRIDGE_MAX_PER_CYCLE ?? 200);

export interface AlertDeliveryResult {
  firing: number;
  delivered: number;
  resolved: number;
  capped: boolean;
  sourcesReached: Record<AlertSourceSystem, boolean>;
  /** True iff BOTH sources were unreachable — nothing delivered or resolved. */
  sourcesUnreachable?: boolean;
  /** Newly-opened alerts pushed to the operator's inbox bell this cycle. */
  notified: number;
}

const ZERO = (reached: Record<AlertSourceSystem, boolean>): AlertDeliveryResult => ({
  firing: 0,
  delivered: 0,
  resolved: 0,
  capped: false,
  sourcesReached: reached,
  notified: 0,
});

/**
 * Pure scan: poll both alert sources, deliver firing alerts to the issue inbox,
 * and reconcile-resolve cleared ones. Exported for unit tests (mirrors
 * runLogSignatureScan / runTokenExpiryScan).
 */
export async function runAlertDeliveryScan(): Promise<AlertDeliveryResult> {
  const { prisma } = await import("@dpf/db");

  const { alerts: rawAlerts, reached } = await fetchAlertSources();
  const alerts = await screenAlertsForSelfDistrust(rawAlerts);

  // Both evaluators down — do nothing. Critically, do NOT resolve anything: an
  // empty firing set here means "we couldn't see", not "everything cleared".
  if (!reached.prometheus && !reached["loki-ruler"]) {
    return { ...ZERO(reached), sourcesUnreachable: true };
  }

  // Persist FIRING only. `pending` alerts are still inside their rule's `for:`
  // debounce window — surfaced live on the dashboard for early warning, but not
  // yet a tracked issue (avoids churning rows for transient blips).
  const firingAll = alerts.filter((a) => a.state === "firing");
  const capped = firingAll.length > MAX_ALERTS_PER_CYCLE;
  const firing = capped ? firingAll.slice(0, MAX_ALERTS_PER_CYCLE) : firingAll;
  if (capped) {
    console.warn(
      `[alert-delivery-bridge] ${firingAll.length} firing alerts exceeds cap ${MAX_ALERTS_PER_CYCLE}; delivering first ${MAX_ALERTS_PER_CYCLE}`,
    );
  }

  // Deliver: upsert one PortfolioQualityIssue per firing alert. Track the keys
  // we just saw firing so reconciliation can resolve the rest.
  // `prisma as never` at the db-handle boundary matches the established pattern
  // for passing the full client to a narrow injectable handle (discovery-runner.ts).
  // Snapshot which health-alert issues are ALREADY open, BEFORE any upsert, so a
  // genuinely new alert can be told apart from one merely re-confirmed this
  // cycle. This transition gate is what keeps the push below from re-nagging:
  // notifyAttention only suppresses duplicates while the notification is UNREAD,
  // so without it, every 5-minute cycle would mint a fresh row the moment the
  // operator reads one — the failure mode that left 5199 unread taskrun.stalled
  // rows and trained the inbox to be ignored.
  const previouslyOpen = new Set(
    (
      await prisma.portfolioQualityIssue.findMany({
        where: { issueType: "health_alert", status: "open" },
        select: { issueKey: true },
      })
    ).map((r) => r.issueKey),
  );

  const firingKeys = new Set<string>();
  const newlyOpened: { key: string; alert: (typeof firing)[number] }[] = [];
  let delivered = 0;
  for (const a of firing) {
    const key = await upsertHealthAlertIssue(prisma as never, {
      labels: a.labels,
      annotations: a.annotations,
      activeAt: a.activeAt,
      sourceSystem: a.sourceSystem,
    });
    firingKeys.add(key);
    delivered++;
    if (!previouslyOpen.has(key)) newlyOpened.push({ key, alert: a });
  }

  // Push NEW alerts to the operator's inbox bell.
  //
  // The read-only projection into the attention inbox
  // (lib/attention/sources/platform-health.ts) already existed, but nothing ever
  // pushed — the row only surfaced if a human happened to open that view. So
  // WindowsHostDiskCritical ("disk G: above 90%") sat open and re-confirmed every
  // 5 minutes for TWELVE DAYS, from 2026-07-19 until the disk hit 0 bytes free on
  // 2026-07-31, took the VM's ext4 filesystem read-only, and killed Postgres with
  // SIGBUS. Detection, delivery and persistence all worked; only the last mile to
  // a human was missing. This is that last mile.
  let notified = 0;
  if (newlyOpened.length > 0) {
    const { notifyAttentionLive, resolveOperatorRecipient } = await import(
      "@/lib/attention/notify-live"
    );
    const recipient = await resolveOperatorRecipient();
    // No resolvable owner → skip silently; notification is best-effort by
    // contract and must never fail the delivery path.
    if (recipient) {
      for (const { key, alert } of newlyOpened) {
        await notifyAttentionLive({
          source: "platform-health",
          itemKey: key,
          userId: recipient,
          title: alert.annotations?.summary ?? alert.labels.alertname ?? "Platform health alert",
          body: alert.annotations?.description,
          deepLink: "/ops/health",
          riskClass: alert.labels.severity === "critical" ? "high-risk" : "bounded-write",
        });
        notified++;
      }
    }
  }

  // Reconcile-resolve. Only resolve open issues that (a) we OWN via a source we
  // actually reached this cycle, and (b) are no longer in the firing set. This
  // is the guard against false-resolve: if Prometheus was unreachable, we leave
  // every prometheus-sourced issue open even though it's absent from `firing`.
  const respondedSources = new Set<string>(
    (Object.keys(reached) as AlertSourceSystem[]).filter((s) => reached[s]),
  );
  const openIssues = await prisma.portfolioQualityIssue.findMany({
    where: { issueType: "health_alert", status: "open" },
    select: { issueKey: true, details: true },
  });
  let resolved = 0;
  for (const row of openIssues) {
    const source = (row.details as { source?: string } | null)?.source;
    // Never auto-resolve webhook-owned rows or rows from an unreached source.
    if (!source || !respondedSources.has(source)) continue;
    if (firingKeys.has(row.issueKey)) continue;
    await resolveHealthAlertIssue(prisma as never, row.issueKey);
    resolved++;
  }

  return { firing: firingAll.length, delivered, resolved, capped, sourcesReached: reached, notified };
}

// BI-915C40C6: every-minute crons multiply orphan accumulation (1440 runs/day).
// Alert delivery does not need 60s latency — Prometheus/Loki already debounce
// with `for:` windows — so poll every 5 minutes. taskrun-watchdog remains the
// sole deliberate every-minute liveness guard (see catalog allowlist test).
export const alertDeliveryBridge = inngest.createFunction(
  { id: "ops/alert-delivery-bridge", retries: 2, triggers: [cron("*/5 * * * *")] },
  async ({ step }) => {
    const gate = await gateAtEntry(step, "ops/alert-delivery-bridge");
    if (!gate.proceed) return { skipped: true, reason: gate.reason };

    return await step.run("deliver-alerts", async () => runAlertDeliveryScan());
  },
);
