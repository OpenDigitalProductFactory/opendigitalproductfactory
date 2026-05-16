// Skill curator service for Slice 4 of the governed Hermes learning loop.
//
// Runs daily on a cron; can also be invoked on demand by an admin. For each
// SkillDefinition, classifies operational health via `classifySkillLifecycle`,
// emits an `ImprovementSignal` per non-active finding (deduped on
// (sourceType, sourceId)), updates `lifecycleState` (with pin protection),
// and writes a single `TaskArtifact(metadata.kind="curator-report")` under
// a proactive TaskRun. **Never mutates SkillDefinition.skillMdContent.**
//
// Pin protection: skills in `pinned` or `quarantined` state are sticky —
// the classifier returns the current state unchanged and the curator never
// overrides it. Operator action (pinSkill/quarantineSkill/unpinSkill server
// actions) is the only way to move skills into or out of those states.

import { randomUUID } from "crypto";

import type { Prisma } from "@dpf/db";
import { prisma } from "@dpf/db";

import { createOrTouchImprovementSignal } from "@/lib/improvement-flywheel/signals";
import {
  classifySkillLifecycle,
  isCuratorImmutable,
  isSkillLifecycleState,
  type SkillLifecycleState,
} from "./lifecycle";

export const CURATOR_REPORT_KIND = "curator-report";

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

export type CuratorFinding = {
  skillId: string;
  fromState: SkillLifecycleState;
  toState: SkillLifecycleState;
  reason: string;
  changed: boolean;
};

export type CuratorReport = {
  scannedAt: string;
  totals: Record<SkillLifecycleState, number>;
  findings: CuratorFinding[];
  reportArtifactId: string | null;
  taskRunPublicId: string | null;
};

export type RunSkillCuratorInput = {
  /** Reviewer or system user attributed for the proactive TaskRun. */
  invokedByUserId: string;
  /** Optional override for "now" — used in tests. */
  now?: Date;
};

/**
 * Run the skill curator. Pure with respect to skill content — it can only
 * write to SkillDefinition.lifecycleState (no other columns) and emit
 * audit rows (TaskRun, TaskArtifact, ImprovementSignal). Pinned skills
 * are never moved.
 */
export async function runSkillCurator(
  input: RunSkillCuratorInput,
): Promise<CuratorReport> {
  const scannedAt = input.now ?? new Date();
  const since = new Date(scannedAt.getTime() - THIRTY_DAYS_MS);

  const skills = await prisma.skillDefinition.findMany({
    select: {
      skillId: true,
      category: true,
      skillMdContent: true,
      lifecycleState: true,
      assignments: { select: { id: true } },
    },
  });

  // Per-skill usage counts in the last 30 days.
  const usageBySkill = await prisma.skillUsageEvent.groupBy({
    by: ["skillId", "phase"],
    where: { createdAt: { gte: since } },
    _count: { _all: true },
  });
  const usageMap = new Map<string, { invoked: number; failed: number }>();
  for (const row of usageBySkill) {
    const entry = usageMap.get(row.skillId) ?? { invoked: 0, failed: 0 };
    if (row.phase === "invoked") entry.invoked = row._count._all;
    if (row.phase === "failed") entry.failed = row._count._all;
    usageMap.set(row.skillId, entry);
  }

  const lastUsedMap = new Map<string, Date>();
  const lastUsedRows = await prisma.skillUsageEvent.findMany({
    where: { createdAt: { gte: since } },
    orderBy: { createdAt: "desc" },
    select: { skillId: true, createdAt: true },
    distinct: ["skillId"],
  });
  for (const r of lastUsedRows) lastUsedMap.set(r.skillId, r.createdAt);

  const findings: CuratorFinding[] = [];
  const totals: Record<SkillLifecycleState, number> = {
    active: 0,
    stale: 0,
    pinned: 0,
    quarantined: 0,
    archived: 0,
  };

  for (const s of skills) {
    const currentRaw = s.lifecycleState;
    const current: SkillLifecycleState = isSkillLifecycleState(currentRaw)
      ? currentRaw
      : "active";
    const usage30d = usageMap.get(s.skillId) ?? { invoked: 0, failed: 0 };
    const result = classifySkillLifecycle({
      current,
      usage30d,
      assignmentCount: s.assignments.length,
      lastUsedAt: lastUsedMap.get(s.skillId) ?? null,
      hasContent: typeof s.skillMdContent === "string" && s.skillMdContent.trim().length > 0,
    });

    const next = isCuratorImmutable(current) ? current : result.next;
    totals[next] = (totals[next] ?? 0) + 1;
    const changed = next !== current;
    findings.push({
      skillId: s.skillId,
      fromState: current,
      toState: next,
      reason: result.reason,
      changed,
    });

    if (changed) {
      // Whitelist the column we mutate — explicit object literal so the
      // curator cannot accidentally update skillMdContent or any other
      // field through this code path. Verified by curator.test.ts.
      await prisma.skillDefinition.update({
        where: { skillId: s.skillId },
        data: { lifecycleState: next },
      });
    }

    // Emit a finding signal only when the next state is non-active AND not
    // operator-set (pinned/quarantined). Operator-set states are intentional
    // — surfacing them every day would be noise. (sourceType, sourceId)
    // dedupe means re-runs on the same population increment recurrenceCount
    // rather than producing parallel signals.
    if (next !== "active" && !isCuratorImmutable(next)) {
      await createOrTouchImprovementSignal({
        sourceType: "curator-finding",
        sourceId: `${s.skillId}:${next}`,
        title: `Skill ${s.skillId} is ${next}`,
        description: result.reason,
        evidence: {
          fromState: current,
          toState: next,
          usage30d,
          assignmentCount: s.assignments.length,
        },
        suspectedRootCause: result.reason,
      });
    }
  }

  // Persist the report as a TaskArtifact under a fresh proactive TaskRun.
  const taskRunPublicId = `TR-CUR-${randomUUID().slice(0, 8).toUpperCase()}`;
  const taskRun = await prisma.taskRun.create({
    data: {
      taskRunId: taskRunPublicId,
      userId: input.invokedByUserId,
      title: "Skill curator dry-run pass",
      objective:
        "Classify every SkillDefinition into lifecycleState and emit governed findings.",
      source: "proactive",
      status: "completed",
      authorityScope: [],
      a2aMetadata: { trigger: "skill-curator" } as Prisma.InputJsonValue,
      currentAgentId: null,
      initiatingAgentId: null,
      routeContext: "/platform/ai/skills",
      completedAt: scannedAt,
    },
    select: { id: true, taskRunId: true },
  });

  const artifactId = `ta_${randomUUID()}`;
  await prisma.taskArtifact.create({
    data: {
      id: randomUUID(),
      artifactId,
      taskRunId: taskRun.id,
      name: "Skill curator report",
      description: `Scanned ${skills.length} skills, ${findings.filter((f) => f.changed).length} state changes`,
      parts: [
        {
          type: "curator-report",
          mimeType: "application/json",
          data: {
            scannedAt: scannedAt.toISOString(),
            totals,
            findings,
          },
        },
      ] as Prisma.InputJsonValue,
      metadata: { kind: CURATOR_REPORT_KIND } as Prisma.InputJsonValue,
    },
  });

  return {
    scannedAt: scannedAt.toISOString(),
    totals,
    findings,
    reportArtifactId: artifactId,
    taskRunPublicId,
  };
}

/**
 * Read the most-recent curator report (TaskArtifact with metadata.kind =
 * 'curator-report'). Returns null if no curator has ever run.
 */
export async function getLatestCuratorReport(): Promise<
  { artifactId: string; scannedAt: string; totals: Record<SkillLifecycleState, number>; findings: CuratorFinding[]; createdAt: string } | null
> {
  // Postgres JSONB path predicate. Prisma's filter syntax for JSON columns:
  // metadata: { path: ["kind"], equals: "curator-report" } in the engine.
  const row = await prisma.taskArtifact.findFirst({
    where: {
      metadata: { path: ["kind"], equals: CURATOR_REPORT_KIND } as Prisma.JsonFilter,
    },
    orderBy: { createdAt: "desc" },
    select: { id: true, artifactId: true, parts: true, createdAt: true },
  });
  if (!row) return null;
  const parts = Array.isArray(row.parts) ? (row.parts as unknown[]) : [];
  const reportPart = parts.find(
    (p) => typeof p === "object" && p !== null && (p as { type?: string }).type === "curator-report",
  ) as { data?: { scannedAt?: string; totals?: Record<string, number>; findings?: CuratorFinding[] } } | undefined;
  if (!reportPart?.data) return null;
  return {
    artifactId: row.artifactId,
    scannedAt: reportPart.data.scannedAt ?? "",
    totals: (reportPart.data.totals ?? {}) as Record<SkillLifecycleState, number>,
    findings: reportPart.data.findings ?? [],
    createdAt: row.createdAt.toISOString(),
  };
}
