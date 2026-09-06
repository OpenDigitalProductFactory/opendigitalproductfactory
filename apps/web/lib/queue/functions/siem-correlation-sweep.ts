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
import {
  detectionRowToGroupingInput,
  groupDetectionsIntoCases,
  maxSeverity,
  type DetectionRowForGrouping,
} from "@/lib/security/case-grouping";
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
  /** SecurityCases opened this cycle from open, un-cased detections (§6.4). */
  casesOpened: number;
}

/**
 * The asset/actor a detection is "about", for case grouping. Device hostname
 * first (host-scoped events), then the acting user/principal, else "unknown"
 * (the detection still groups by scope + family). Json-safe.
 */
function deriveEntityKey(device: unknown, actor: unknown): string {
  const host = (device as { hostname?: unknown } | null)?.hostname;
  if (typeof host === "string" && host) return host;
  const a = (actor ?? {}) as { user?: { name?: unknown }; name?: unknown; uid?: unknown };
  const user = a.user?.name ?? a.name ?? a.uid;
  if (typeof user === "string" && user) return user;
  return "unknown";
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
      device: true,
      actor: true,
    },
  });

  let detectionsUpserted = 0;
  for (const ev of events) {
    const candidates = evaluateRulesForEvent(ruleViews, toEventView(ev), {
      indicatorIndex: index,
    });
    // Stamp the matched entity onto the detection so case grouping can run off
    // the persisted row without re-joining to the event (case-grouping.ts).
    const entityKey = deriveEntityKey(ev.device, ev.actor);
    for (const c of candidates) {
      const enrichment = { ...c.enrichment, entityKey };
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
          enrichment: enrichment as object,
          firstSeenAt: c.firstSeenAt,
          lastSeenAt: c.lastSeenAt,
        },
        // Replay refreshes the operator-visible fields + lastSeenAt; firstSeenAt
        // and status (operator/coworker-owned) are left intact.
        update: {
          severity: c.severity,
          riskScore: c.riskScore,
          enrichment: enrichment as object,
          lastSeenAt: c.lastSeenAt,
        },
      });
      detectionsUpserted++;
    }
  }

  // ── Detection --> Case (spec §6.4): group open, un-cased detections into
  //    SecurityCases so the AI SOC has a case to triage without a human first
  //    opening one. Idempotent: the grouping key is stable, so a re-run merges
  //    into the same case rather than spawning duplicates. Coworkers can still
  //    open cases manually (open_security_case) — both edges feed one model.
  const casesOpened = await groupOpenDetectionsIntoCases(prisma, now);

  return {
    rules: rules.length,
    indicators: index.size,
    eventsScanned: events.length,
    detectionsUpserted,
    casesOpened,
  };
}

/**
 * Resolve a detection's entity to a human label when it is an actor principal.
 * BI-7D1EC4B9: an internal-authorization detection's entity is the actor's id —
 * an agent slug (already readable) or a bare User cuid (which rendered as an
 * unresolvable machine id on the console). Returns null for a non-actor entity
 * (hostname/asset) or one that resolves to neither, so the caller keeps the raw
 * key rather than inventing a name.
 */
async function resolveEntityActorLabel(
  prisma: typeof import("@dpf/db").prisma,
  entityKey: string,
): Promise<string | null> {
  if (!entityKey || entityKey === "unknown") return null;
  const agent = await prisma.agent.findFirst({
    where: { OR: [{ agentId: entityKey }, { id: entityKey }] },
    select: { displayName: true, name: true, agentId: true },
  });
  if (agent) return agent.displayName || agent.name || agent.agentId;
  const user = await prisma.user.findUnique({
    where: { id: entityKey },
    select: { email: true },
  });
  if (user) return user.email;
  return null;
}

/**
 * Group every OPEN, un-cased Detection into a SecurityCase. Detections already
 * linked to a case (securityCaseId set) are excluded, so each detection is
 * grouped exactly once; an existing case absorbs new same-key detections and
 * ratchets to the max severity. Returns the count of NEW cases opened.
 */
async function groupOpenDetectionsIntoCases(
  prisma: typeof import("@dpf/db").prisma,
  now: Date,
): Promise<number> {
  const ungrouped = await prisma.detection.findMany({
    where: { status: "open", securityCaseId: null },
    select: {
      detectionKey: true,
      scopeKey: true,
      customerAccountId: true,
      customerSiteId: true,
      severity: true,
      firstSeenAt: true,
      lastSeenAt: true,
      enrichment: true,
    },
    take: SWEEP_EVENT_CAP,
  });
  if (ungrouped.length === 0) return 0;

  const candidates = groupDetectionsIntoCases(
    ungrouped.map((d) =>
      detectionRowToGroupingInput(d as unknown as DetectionRowForGrouping),
    ),
  );

  let casesOpened = 0;
  for (const cand of candidates) {
    const existing = await prisma.securityCase.findUnique({
      where: { caseKey: cand.caseKey },
      select: { id: true, severity: true },
    });
    let caseId: string;
    if (existing) {
      caseId = existing.id;
      const merged = maxSeverity(existing.severity, cand.severity);
      if (merged !== existing.severity) {
        await prisma.securityCase.update({ where: { id: caseId }, data: { severity: merged } });
      }
    } else {
      // BI-7D1EC4B9: resolve an actor entity (a User id rendered as a raw cuid,
      // or an agent principal) to a human label so the title answers "who" with
      // a name, not a machine id. A non-actor entity (hostname/asset) or an
      // unresolvable key keeps the composed title unchanged.
      const actorLabel = await resolveEntityActorLabel(prisma, cand.entityKey);
      const title =
        actorLabel && cand.entityKey !== "unknown"
          ? `${cand.ruleName} — ${actorLabel}`
          : cand.title;
      const created = await prisma.securityCase.create({
        data: {
          caseKey: cand.caseKey,
          scopeKey: cand.scopeKey,
          customerAccountId: cand.customerAccountId,
          customerSiteId: cand.customerSiteId,
          title,
          severity: cand.severity,
          status: "new",
          verdict: "unknown",
          // BI-7D1EC4B9: a case that demands a decision must carry the detections
          // it was opened from, not an empty {}. The detection rows are also
          // linked by securityCaseId below; these keys make them reachable from
          // the case itself.
          evidence: {
            openedBy: "correlation-sweep",
            detectionKeys: cand.detectionKeys,
            detectionCount: cand.detectionKeys.length,
          } as object,
          timeline: [
            {
              at: now.toISOString(),
              kind: "auto-opened",
              note: `Opened by the correlation sweep from ${cand.detectionKeys.length} detection(s).`,
            },
          ] as object,
          openedAt: cand.firstSeenAt,
        },
        select: { id: true },
      });
      caseId = created.id;
      casesOpened++;
    }
    // Link the grouped detections (only those still un-cased — idempotent).
    await prisma.detection.updateMany({
      where: { detectionKey: { in: cand.detectionKeys }, securityCaseId: null },
      data: { securityCaseId: caseId },
    });
  }
  return casesOpened;
}

export const siemCorrelationSweep = inngest.createFunction(
  { id: "ops/siem-correlation-sweep", retries: 2, triggers: [cron("3,18,33,48 * * * *")] },
  async ({ step }) => {
    const gate = await gateAtEntry(step, "ops/siem-correlation-sweep");
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
