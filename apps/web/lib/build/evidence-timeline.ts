// Server-side projection of cross-surface development evidence onto the Build
// Studio unified evidence timeline.
//
// EP-UNIFIED-TRACKING Phase 1 (BI-C25374E4). Until now the "external"/"codex"
// lane on the timeline was FAKED from FeatureBuild.codingProvider (the in-sandbox
// engine Build Studio itself ran) — genuinely external-agent work was invisible.
// This module reads the real records keyed to the build and merges them:
//   - ExternalEvidenceRecord  (record_external_development_evidence) — by buildId OR workCapsuleId
//   - RuntimeVerification     (record_runtime_verification)         — keyed by FeatureBuild.id (cuid)
//   - WorkroomActivity     (record_capsule_evidence)             — via the build's linked capsule
//
// Read-only: no write-model change here. The ExternalEvidenceRecord -> capsule
// link this projection reads is populated by EP-WORK-CONVERGENCE Phase 1
// (BI-D6FA8641), which lets capsule-bound external-agent work (no FeatureBuild
// required) surface on the timeline, not just build-keyed records.
//
// Spec: docs/superpowers/specs/2026-06-19-unified-build-studio-tracking-all-surfaces-design.md §6.1

import type { UnifiedEvidenceTimelineEvent } from "./evidence-timeline-types";

export type ExternalEvidenceRow = {
  id: string;
  provider: string;
  resultSummary: string;
  createdAt: Date;
};

export type RuntimeVerificationRow = {
  verificationId: string;
  kind: string;
  status: string;
  completedAt: Date | null;
  result: unknown;
};

export type CapsuleEvidenceActivityRow = {
  id: string;
  summary: string;
  recordedAt: Date;
};

export type BuildEvidenceSources = {
  externalRecords: ExternalEvidenceRow[];
  runtimeVerifications: RuntimeVerificationRow[];
  capsuleEvidence: CapsuleEvidenceActivityRow[];
};

/** Title-case a provider slug ("grok" -> "Grok", "claude-code" -> "Claude Code"). */
function providerLabel(provider: string): string {
  const trimmed = provider.trim();
  if (!trimmed) return "External agent";
  return trimmed
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function runtimeStatusToEventStatus(status: string): UnifiedEvidenceTimelineEvent["status"] {
  const normalized = status.trim().toLowerCase();
  if (["passed", "verified", "success", "succeeded", "ok"].includes(normalized)) return "passed";
  if (["failed", "fail", "error", "errored"].includes(normalized)) return "failed";
  if (["pending", "running", "in-progress", "in_progress", "started"].includes(normalized)) return "pending";
  return "recorded";
}

function runtimeResultSummary(result: unknown): string | null {
  if (result && typeof result === "object" && !Array.isArray(result)) {
    const summary = (result as Record<string, unknown>).summary;
    if (typeof summary === "string" && summary.trim()) return summary.trim();
  }
  return null;
}

function msOf(value: Date | null | undefined): number {
  return value ? value.getTime() : 0;
}

/**
 * Pure projection: map fetched cross-surface evidence rows to timeline events,
 * newest first. Deterministic and side-effect-free — the unit-tested core.
 */
export function mapBuildEvidenceTimelineEvents(
  sources: BuildEvidenceSources,
): UnifiedEvidenceTimelineEvent[] {
  const ranked: Array<{ event: UnifiedEvidenceTimelineEvent; ts: number }> = [];

  for (const record of sources.externalRecords) {
    ranked.push({
      ts: msOf(record.createdAt),
      event: {
        id: `external-${record.id}`,
        source: "external",
        label: providerLabel(record.provider),
        summary: record.resultSummary,
        status: "recorded",
        timestamp: record.createdAt,
      },
    });
  }

  for (const verification of sources.runtimeVerifications) {
    ranked.push({
      ts: msOf(verification.completedAt),
      event: {
        id: `runtime-${verification.verificationId}`,
        source: "review",
        label: "Runtime verification",
        summary:
          runtimeResultSummary(verification.result)
          ?? `Runtime ${verification.kind} ${verification.status}.`,
        status: runtimeStatusToEventStatus(verification.status),
        timestamp: verification.completedAt,
      },
    });
  }

  for (const activity of sources.capsuleEvidence) {
    ranked.push({
      ts: msOf(activity.recordedAt),
      event: {
        id: `capsule-${activity.id}`,
        source: "external",
        label: "Capsule evidence",
        summary: activity.summary,
        status: "recorded",
        timestamp: activity.recordedAt,
      },
    });
  }

  return ranked.sort((a, b) => b.ts - a.ts).map((entry) => entry.event);
}

/** Structural DB surface — the real prisma client satisfies it (cf. CapsuleDb). */
export type EvidenceTimelineDb = {
  externalEvidenceRecord: { findMany(args: unknown): Promise<unknown[]> };
  runtimeVerification: { findMany(args: unknown): Promise<unknown[]> };
  workroom: { findFirst(args: unknown): Promise<unknown> };
  workroomActivity: { findMany(args: unknown): Promise<unknown[]> };
};

/**
 * Fetch the three cross-surface evidence sources for a build and project them.
 * `build.buildId` is the FB- id (ExternalEvidenceRecord.buildId); `build.id` is
 * the cuid (RuntimeVerification.featureBuildId / Workroom.featureBuildId).
 */
export async function loadBuildEvidenceTimelineEvents(args: {
  db: EvidenceTimelineDb;
  build: { id: string; buildId: string };
  limitPerSource?: number;
}): Promise<UnifiedEvidenceTimelineEvent[]> {
  const take = args.limitPerSource ?? 25;

  // Resolve the capsule first so external evidence can be matched by capsule
  // link as well as by build id — external-agent work is bound to the capsule
  // and may carry no FeatureBuild, so a buildId-only read would miss it.
  const capsule = (await args.db.workroom.findFirst({
    where: { featureBuildId: args.build.id },
    select: { id: true },
  })) as { id: string } | null;

  const [externalRecords, runtimeVerifications] = await Promise.all([
    args.db.externalEvidenceRecord.findMany({
      where: capsule
        ? { OR: [{ buildId: args.build.buildId }, { workCapsuleId: capsule.id }] }
        : { buildId: args.build.buildId },
      orderBy: { createdAt: "desc" },
      take,
      select: { id: true, provider: true, resultSummary: true, createdAt: true },
    }) as Promise<ExternalEvidenceRow[]>,
    args.db.runtimeVerification.findMany({
      where: { featureBuildId: args.build.id },
      orderBy: { completedAt: "desc" },
      take,
      select: { verificationId: true, kind: true, status: true, completedAt: true, result: true },
    }) as Promise<RuntimeVerificationRow[]>,
  ]);

  const capsuleEvidence = capsule
    ? ((await args.db.workroomActivity.findMany({
      where: { workCapsuleId: capsule.id, kind: "evidence-recorded" },
      orderBy: { recordedAt: "desc" },
      take,
      select: { id: true, summary: true, recordedAt: true },
    })) as CapsuleEvidenceActivityRow[])
    : [];

  return mapBuildEvidenceTimelineEvents({ externalRecords, runtimeVerifications, capsuleEvidence });
}
