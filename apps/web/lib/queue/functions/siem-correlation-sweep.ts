// apps/web/lib/queue/functions/siem-correlation-sweep.ts
// EP-SOVEREIGN-SOC P1c (BI-6D9496F1) — the detection correlation sweep.
//
// Every 15 minutes: (1) project the platform's own audit telemetry into
// SecurityEvents (self-monitoring), then (2) scan the recent SecurityEvent
// window against enabled DetectionRules + the active ThreatIndicator index and
// upsert Detection rows. Models the log-signature-scanner exactly: a pure
// exported scan function (so tests drive it without the Inngest harness) + a
// thin wrapper with the quiescence gate. Detection idempotency is DB-backed via
// Detection.detectionKey (rule+event), so a replay refreshes lastSeenAt rather
// than duplicating.
//
// Spec: docs/superpowers/specs/2026-06-24-sovereign-soc-siem-design.md §4.3, §7.1.

import { cron } from "inngest";

import {
  evaluateRulesForEvent,
  type DetectionPredicate,
  type DetectionRuleView,
  type SecurityEventView,
} from "@/lib/security/detection";
import { ensureKernelDetectionPack } from "@/lib/security/detection-pack";
import { runInternalSecurityProjection } from "@/lib/security/internal-projector";
import {
  buildIndicatorIndex,
  type ThreatIndicatorView,
} from "@/lib/security/threat-intel";

import { inngest } from "../inngest-client";
import { gateAtEntry } from "../quiescence-gates";

const SWEEP_LOOKBACK_MIN = Number(
  process.env.DPF_SIEM_SWEEP_LOOKBACK_MIN ?? 30,
);
const SWEEP_EVENT_CAP = Number(process.env.DPF_SIEM_SWEEP_EVENT_CAP ?? 2000);

export interface CorrelationSweepResult {
  rules: number;
  indicators: number;
  eventsScanned: number;
  detectionsUpserted: number;
}

function toRuleView(rule: {
  id: string;
  ruleKey: string;
  name: string;
  severity: string;
  scopeKey: string;
  enabled: boolean;
  predicate: unknown;
  mitreTechniques: unknown;
}): DetectionRuleView {
  return {
    id: rule.id,
    ruleKey: rule.ruleKey,
    name: rule.name,
    severity: rule.severity,
    scopeKey: rule.scopeKey,
    enabled: rule.enabled,
    predicate: (rule.predicate ?? {}) as DetectionPredicate,
    mitreTechniques: Array.isArray(rule.mitreTechniques)
      ? (rule.mitreTechniques as string[])
      : [],
  };
}

function toEventView(ev: {
  eventKey: string;
  ocsfClassUid: number;
  severityId: number | null;
  sourceKind: string;
  scopeKey: string;
  customerAccountId: string | null;
  customerSiteId: string | null;
  time: Date;
  observables: unknown;
  normalized: unknown;
}): SecurityEventView {
  return {
    eventKey: ev.eventKey,
    ocsfClassUid: ev.ocsfClassUid,
    severityId: ev.severityId,
    sourceKind: ev.sourceKind,
    scopeKey: ev.scopeKey,
    customerAccountId: ev.customerAccountId,
    customerSiteId: ev.customerSiteId,
    time: ev.time,
    observables: ev.observables,
    normalized: ev.normalized,
  };
}

/**
 * The detection scan, exported separately so unit tests can drive it with a
 * mocked Prisma client (mirrors runLogSignatureScan / runTokenExpiryScan).
 */
export async function runCorrelationSweep(opts?: {
  since?: Date;
  limit?: number;
  /** Create-if-missing seed of the kernel detection pack (default true). */
  seedPack?: boolean;
}): Promise<CorrelationSweepResult> {
  const { prisma } = await import("@dpf/db");
  const since =
    opts?.since ?? new Date(Date.now() - SWEEP_LOOKBACK_MIN * 60 * 1000);
  const limit = opts?.limit ?? SWEEP_EVENT_CAP;
  const now = new Date();

  // Ensure the kernel detection pack exists (create-if-missing; operator tuning
  // of existing rules is preserved) so the sweep always has baseline rules.
  if (opts?.seedPack !== false) {
    await ensureKernelDetectionPack();
  }

  const [rules, indicators] = await Promise.all([
    prisma.detectionRule.findMany({
      where: { enabled: true },
      select: {
        id: true,
        ruleKey: true,
        name: true,
        severity: true,
        scopeKey: true,
        enabled: true,
        predicate: true,
        mitreTechniques: true,
      },
    }),
    prisma.threatIndicator.findMany({
      // Plausibly-active indicators; buildIndicatorIndex applies the exact
      // validity window. Open-ended (validUntil null) are always candidates.
      where: { OR: [{ validUntil: null }, { validUntil: { gte: now } }] },
      select: {
        indicatorKey: true,
        indicatorType: true,
        value: true,
        source: true,
        confidence: true,
        severity: true,
        validFrom: true,
        validUntil: true,
      },
    }),
  ]);

  const ruleViews = rules.map(toRuleView);
  const index = buildIndicatorIndex(indicators as ThreatIndicatorView[], now);

  const events = await prisma.securityEvent.findMany({
    where: { time: { gte: since } },
    orderBy: { time: "asc" },
    take: limit,
    select: {
      eventKey: true,
      ocsfClassUid: true,
      severityId: true,
      sourceKind: true,
      scopeKey: true,
      customerAccountId: true,
      customerSiteId: true,
      time: true,
      observables: true,
      normalized: true,
    },
  });

  let detectionsUpserted = 0;
  for (const ev of events) {
    const candidates = evaluateRulesForEvent(ruleViews, toEventView(ev), {
      indicatorIndex: index,
    });
    for (const c of candidates) {
      await prisma.detection.upsert({
        where: { detectionKey: c.detectionKey },
        create: {
          detectionKey: c.detectionKey,
          ruleId: c.ruleId,
          scopeKey: c.scopeKey,
          customerAccountId: c.customerAccountId,
          customerSiteId: c.customerSiteId,
          severity: c.severity,
          status: "open",
          riskScore: c.riskScore,
          matchedEventRefs: c.matchedEventRefs as object,
          enrichment: c.enrichment as object,
          firstSeenAt: c.firstSeenAt,
          lastSeenAt: c.lastSeenAt,
        },
        // Replay refreshes the operator-visible fields + lastSeenAt; firstSeenAt
        // and status (operator/coworker-owned) are left intact.
        update: {
          severity: c.severity,
          riskScore: c.riskScore,
          enrichment: c.enrichment as object,
          lastSeenAt: c.lastSeenAt,
        },
      });
      detectionsUpserted++;
    }
  }

  return {
    rules: rules.length,
    indicators: index.size,
    eventsScanned: events.length,
    detectionsUpserted,
  };
}

export const siemCorrelationSweep = inngest.createFunction(
  { id: "ops/siem-correlation-sweep", retries: 2, triggers: [cron("3,18,33,48 * * * *")] },
  async ({ step }) => {
    const gate = await gateAtEntry(step);
    if (!gate.proceed) return { skipped: true, reason: gate.reason };

    // 1. Flow the platform's own audit telemetry into SecurityEvents first, so
    //    the sweep scans fresh internal events in the same cycle.
    const projected = await step.run("project-internal-security-events", async () =>
      runInternalSecurityProjection(),
    );
    // 2. Scan the SecurityEvent window and emit detections.
    const swept = await step.run("siem-correlation-sweep", async () =>
      runCorrelationSweep(),
    );

    return { projected, swept };
  },
);
