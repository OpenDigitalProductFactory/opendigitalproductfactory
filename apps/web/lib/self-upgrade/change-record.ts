import { prisma } from "@dpf/db";
import {
  registerChange,
  driveChangeThrough,
} from "@/lib/change-management/register-change";

// ─────────────────────────────────────────────────────────────────────────────
// Self-upgrade → change management register mirror.
//
// Every self-upgrade is registered as an ITIL STANDARD change (pre-approved,
// repeatable, automated, auto-closed) in the existing ChangeRequest register —
// no new table, no new approval gate, no new UI route. The change record is a
// faithful SHADOW of the SelfUpgradeRun: created and transitioned in lockstep,
// reading everything off the persisted run row so callers pass only a runId.
//
// Wired at the run-store lifecycle chokepoints (start/complete/fail/skip/cancel)
// so coverage is total without touching the 560-line orchestrator. The record is
// opened LAZILY on the first real action or failure — a queued tick that then
// skips (cooldown / up-to-date / no-target / promoter-unavailable / in-flight)
// is a non-event and produces no record, keeping the register free of no-op noise.
//
// Spec: docs/superpowers/specs/2026-06-16-self-upgrade-change-register-design.md
// ─────────────────────────────────────────────────────────────────────────────

const SELF_UPGRADE_ITEM_TYPE = "platform-self-upgrade";
const FAILURE_NOTE_MAX = 2000;

type LooseSummary = {
  counts?: Record<string, number> | null;
  phrased?: { headline?: string | null } | null;
};

type RunForMirror = {
  runId: string;
  status: string;
  trigger: string;
  currentSha: string | null;
  targetSha: string | null;
  deployedSha: string | null;
  reason: string | null;
  failureLog: string | null;
  completionEvidence: unknown;
  startedAt: Date | null;
  completedAt: Date | null;
  changeRequestId: string | null;
  impactSummaryId: string | null;
  impactSummary: { summary: unknown } | null;
};

type DriveStep = { status: string; extra?: Record<string, unknown> };
type MirrorPlan = { create: string; steps: DriveStep[] };

function short(sha: string | null): string {
  return sha ? sha.slice(0, 7) : "unknown";
}

function readImpact(run: RunForMirror): { summary: LooseSummary | null; riskLevel: string } {
  const summary = (run.impactSummary?.summary ?? null) as LooseSummary | null;
  const breaking = Number(summary?.counts?.breaking ?? 0) || 0;
  return { summary, riskLevel: breaking > 0 ? "medium" : "low" };
}

function buildTitle(run: RunForMirror): string {
  const to = run.targetSha ?? run.deployedSha;
  return `Platform self-upgrade ${short(run.currentSha)} → ${short(to)}`;
}

function buildDescription(run: RunForMirror, summary: LooseSummary | null): string {
  const to = run.targetSha ?? run.deployedSha;
  const headline = summary?.phrased?.headline?.trim();
  const base =
    `Automated platform self-upgrade (run ${run.runId}, trigger: ${run.trigger}). ` +
    `Source ${short(run.currentSha)} → target ${short(to)}.`;
  return headline ? `${base} ${headline}` : base;
}

function buildImpactReport(
  run: RunForMirror,
  summary: LooseSummary | null,
): Record<string, unknown> {
  return {
    source: "self-upgrade",
    runId: run.runId,
    trigger: run.trigger,
    fromSha: run.currentSha,
    toSha: run.targetSha ?? run.deployedSha,
    // The full UpgradeImpactSummary lives in its own table (single source of
    // truth); we carry only the headline + counts here and a pointer to it.
    impactSummaryId: run.impactSummaryId,
    ...(summary
      ? { headline: summary.phrased?.headline ?? null, counts: summary.counts ?? null }
      : {}),
  };
}

function buildVerification(run: RunForMirror): Record<string, unknown> {
  return {
    recoveryPoint: run.completionEvidence ?? null,
    deployedSha: run.deployedSha,
    completedAt: run.completedAt ? run.completedAt.toISOString() : null,
  };
}

/**
 * Map the run's current status to the change record's create-stage and the
 * forward steps to drive it to its terminal state. Returns null when no record
 * should exist yet (queued/pending) or for a no-op skip with no prior record.
 */
function planForRun(run: RunForMirror): MirrorPlan | null {
  const started =
    !!run.startedAt ||
    run.status === "running" ||
    run.status === "completing" ||
    run.status === "succeeded";
  const failureNote = (run.failureLog ?? "").slice(0, FAILURE_NOTE_MAX) || undefined;
  const failExtra = { outcome: "failed", ...(failureNote ? { outcomeNotes: failureNote } : {}) };

  switch (run.status) {
    case "running":
    case "completing":
      return { create: "in-progress", steps: [] };
    case "succeeded":
      return {
        create: "in-progress",
        steps: [
          { status: "completed", extra: { outcome: "succeeded", postChangeVerification: buildVerification(run) } },
          { status: "closed" },
        ],
      };
    case "failed":
    case "rolled_back":
      // Failed AFTER the swap was attempted (record was in-progress) → rolled-back.
      // Failed BEFORE execution (merge conflict, quiescence defer) → cancelled.
      return started
        ? { create: "in-progress", steps: [{ status: "rolled-back", extra: failExtra }, { status: "closed" }] }
        : { create: "scheduled", steps: [{ status: "cancelled", extra: failExtra }, { status: "closed" }] };
    case "cancelled":
      return {
        create: "scheduled",
        steps: [
          { status: "cancelled", extra: { outcomeNotes: run.reason ?? "Self-upgrade run cancelled" } },
          { status: "closed" },
        ],
      };
    case "skipped":
      // A skip is a non-event. Only finalize a record that (unexpectedly) already exists.
      return run.changeRequestId
        ? {
            create: "scheduled",
            steps: [
              { status: "cancelled", extra: { outcomeNotes: run.reason ?? "Self-upgrade skipped" } },
              { status: "closed" },
            ],
          }
        : null;
    default:
      return null; // queued / pending — lazy: no record yet
  }
}

/**
 * Mirror a SelfUpgradeRun into the change management register. Idempotent — safe
 * to call after every run-store mutation; re-runs are no-ops once the record has
 * reached the mirrored state.
 */
export async function syncSelfUpgradeChangeRecord(runId: string): Promise<void> {
  const run = (await prisma.selfUpgradeRun.findUnique({
    where: { runId },
    include: { impactSummary: { select: { summary: true } } },
  })) as RunForMirror | null;
  if (!run) return;

  const plan = planForRun(run);
  if (!plan) return;

  let ref: { id?: string; rfcId?: string };
  if (run.changeRequestId) {
    ref = { id: run.changeRequestId };
  } else {
    const { summary, riskLevel } = readImpact(run);
    const to = run.targetSha ?? run.deployedSha;
    const { id } = await registerChange({
      title: buildTitle(run),
      description: buildDescription(run, summary),
      type: "standard",
      scope: "platform",
      riskLevel,
      status: plan.create,
      impactReport: buildImpactReport(run, summary),
      items: [
        {
          itemType: SELF_UPGRADE_ITEM_TYPE,
          title: `Self-upgrade ${run.runId}`,
          description: `Platform code ${short(run.currentSha)} → ${short(to)}`,
          rollbackPlan:
            "Pre-swap recovery point (Postgres backup) created by the self-upgrade " +
            "pipeline; the promoter retains the prior image and restores it on a failed swap.",
          executionOrder: 0,
        },
      ],
    });
    await prisma.selfUpgradeRun.update({ where: { runId }, data: { changeRequestId: id } });
    ref = { id };
  }

  if (plan.steps.length > 0) {
    await driveChangeThrough(ref, plan.steps);
  }
}

/**
 * Best-effort wrapper for the run-store hooks: the change register is an audit
 * SHADOW, so a mirror failure must never abort an upgrade — but it is logged
 * loudly so the gap is observable (make-silent-failures-observable).
 */
export async function safeSyncSelfUpgradeChangeRecord(runId: string): Promise<void> {
  try {
    await syncSelfUpgradeChangeRecord(runId);
  } catch (err) {
    console.error(
      `[self-upgrade-change-record] failed to mirror run ${runId} into the change register:`,
      err,
    );
  }
}
