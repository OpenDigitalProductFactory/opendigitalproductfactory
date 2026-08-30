// apps/web/lib/build/plan-to-build-transition.ts
//
// Single source of truth for the Build Studio plan→build phase transition
// (BI-05208DE5).
//
// Both the fresh-review path (reviewBuildPlan in mcp-tools.ts) and the
// auto-resume reconciler (resume-pre-build-phase.ts) need to take a build whose
// plan is complete and reviewed and actually flip it into `build` — initializing
// the isolated build branch FIRST so `buildBranch` is set before `phase=build`
// (else deploy_feature runs on whatever leftover HEAD the sandbox is on). That
// logic was duplicated inline in reviewBuildPlan, and it had a load-bearing flaw:
// when the branch-init step threw (the sandbox was down or churning during a
// self-upgrade), the exception was caught and logged as `phase:gate-blocked`, the
// phase never flipped, and the 30-minute auto-resume re-ran the ENTIRE plan
// review (two reviewer model calls + a deliberation trail that stalls) and
// re-attempted the same transition — forever, with no failure counter and no
// age-out for epic-decomposed children (isStrandedPreBuildAbandonable returns
// false when parentEpicId is set). That perpetual loop wedged routine
// self-upgrade (the activity-in-flight skip kept seeing live deliberation
// TaskRuns).
//
// This module extracts the transition into one executor and adds a bounded
// failure tracker on FeatureBuild.buildExecState.planAdvance: repeated transition
// failures are counted and, past a threshold, escalate to the operator instead of
// looping — the only thing that stops an age-out-exempt epic child from flooding.
// The WWMD decision itself is NOT the blocker (the stuck builds carried a cached
// `recommend`, confidence 0.9); the transition SIDE-EFFECT was.

import { prisma, type Prisma } from "@dpf/db";
import {
  canTransitionPhase,
  normalizeHappyPathState,
} from "@/lib/feature-build-types";
import { checkBuildPhaseGate } from "@/lib/work-posture/verification-depth-gate";
import {
  deriveFeatureBuildDependencyGate,
  type FeatureBuildDependencyGateResult,
  FEATURE_BUILD_DEPENDENCY_GATE_SELECT,
} from "@/lib/build/feature-build-dependencies";
import { logBuildActivity } from "@/lib/mcp/build-tool-helpers";
import { resolvePlannedFilePaths } from "@/lib/decision-perspective/planned-file-paths";
import type { DecisionOutcomeType } from "@/lib/decision-perspective/types";
import type { AutonomousBuildExecutionProfileRefV1 } from "@/lib/build/autonomous-build-eligibility-reader";
import { enforceBuildInitiativeReadiness } from "@/lib/build/build-entry-gate";

/**
 * How many consecutive failed plan→build transition attempts before a build
 * escalates to the operator and auto-resume stops re-attempting. Default 3
 * (≈90 min at the 30-min resume cadence): a transient sandbox blip recovers
 * within a cycle (the counter resets on any success), so only a PERSISTENT
 * failure — a real bug or a long sandbox outage — escalates. Override with
 * BUILD_PLAN_ADVANCE_ESCALATE_AFTER.
 */
export const PLAN_ADVANCE_ESCALATE_AFTER =
  Number(process.env.BUILD_PLAN_ADVANCE_ESCALATE_AFTER) || 3;

/** Per-build advance tracker, persisted under `buildExecState.planAdvance`. */
export type PlanAdvanceTracker = {
  failures: number;
  lastError?: string;
  lastAt?: string;
  escalatedAt?: string;
};

export type PlanToBuildTransitionOutcome =
  | { kind: "advanced" }
  | { kind: "not-ready"; reason: string }
  | { kind: "gate-blocked"; reason: string }
  // A blocking sibling was abandoned/failed and can never complete, so this
  // build was terminally abandoned rather than left waiting forever (BI-7B6D7661).
  | { kind: "dependency-unsatisfiable"; reason: string; deadDependencyBuildIds: string[] }
  | { kind: "wwmd-withheld"; reason: string }
  | { kind: "transition-failed"; reason: string; failures: number }
  | { kind: "escalated"; reason: string; failures: number };

// ── Pure helpers (DB-free, unit-tested) ──────────────────────────────────────

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function readPlanAdvanceTracker(buildExecState: unknown): PlanAdvanceTracker | null {
  const state = asRecord(buildExecState);
  const raw = state ? asRecord(state.planAdvance) : null;
  if (!raw) return null;
  return {
    failures: typeof raw.failures === "number" ? raw.failures : 0,
    lastError: typeof raw.lastError === "string" ? raw.lastError : undefined,
    lastAt: typeof raw.lastAt === "string" ? raw.lastAt : undefined,
    escalatedAt: typeof raw.escalatedAt === "string" ? raw.escalatedAt : undefined,
  };
}

/** Increment the failure counter, recording the latest error + timestamp. */
export function recordPlanAdvanceFailure(
  prev: PlanAdvanceTracker | null | undefined,
  error: string,
  now: Date,
): PlanAdvanceTracker {
  return {
    failures: (prev?.failures ?? 0) + 1,
    lastError: error.slice(0, 300),
    lastAt: now.toISOString(),
    ...(prev?.escalatedAt ? { escalatedAt: prev.escalatedAt } : {}),
  };
}

export function shouldEscalatePlanAdvance(args: { failures: number; threshold?: number }): boolean {
  return args.failures >= (args.threshold ?? PLAN_ADVANCE_ESCALATE_AFTER);
}

// ── Tracker persistence ──────────────────────────────────────────────────────

async function persistPlanAdvanceTracker(buildId: string, tracker: PlanAdvanceTracker): Promise<void> {
  try {
    const row = await prisma.featureBuild.findUnique({
      where: { buildId },
      select: { buildExecState: true },
    });
    const existing = asRecord(row?.buildExecState) ?? {};
    await prisma.featureBuild.update({
      where: { buildId },
      data: {
        buildExecState: { ...existing, planAdvance: tracker } as unknown as Prisma.InputJsonValue,
      },
    });
  } catch (err) {
    console.warn("[plan-to-build-transition] failed to persist planAdvance tracker:", { buildId }, err);
  }
}

/** On success, drop the tracker so a later unrelated strand starts clean. */
async function clearPlanAdvanceTracker(buildId: string, existingState: unknown): Promise<void> {
  const rec = asRecord(existingState);
  if (!rec || rec.planAdvance == null) return;
  try {
    const { planAdvance: _drop, ...rest } = rec;
    await prisma.featureBuild.update({
      where: { buildId },
      data: { buildExecState: rest as unknown as Prisma.InputJsonValue },
    });
  } catch {
    /* best-effort */
  }
}

async function failTransition(args: {
  buildId: string;
  parentEpicId: string | null;
  reason: string;
  prevTracker: PlanAdvanceTracker | null;
}): Promise<PlanToBuildTransitionOutcome> {
  const { buildId, parentEpicId, reason, prevTracker } = args;
  const now = new Date();
  let tracker = recordPlanAdvanceFailure(prevTracker, reason, now);

  if (shouldEscalatePlanAdvance({ failures: tracker.failures })) {
    tracker = { ...tracker, escalatedAt: tracker.escalatedAt ?? now.toISOString() };
    await persistPlanAdvanceTracker(buildId, tracker);
    logBuildActivity(
      buildId,
      "phase:needs-operator",
      `plan → build blocked ${tracker.failures}x (${reason}). Auto-resume paused for this build; ` +
        `restart the sandbox and manually advance, or re-promote the backlog item.` +
        (parentEpicId
          ? " (epic-child build — exempt from the 7-day age-out, so this escalation is what stops it looping.)"
          : ""),
    );
    return { kind: "escalated", reason, failures: tracker.failures };
  }

  await persistPlanAdvanceTracker(buildId, tracker);
  logBuildActivity(
    buildId,
    "phase:gate-blocked",
    `plan → build transition failed (attempt ${tracker.failures}): ${reason}`,
  );
  return { kind: "transition-failed", reason, failures: tracker.failures };
}

/**
 * Terminally abandon a plan-phase build whose plan is ready but which depends on
 * a sibling that was abandoned/failed and can never complete (BI-7B6D7661).
 *
 * Without this the build re-enters the resume sweep every cycle, logs
 * "Waiting on: …", and — because decomposition children are exempt from the
 * 7-day pre-build age-out — waits forever. Abandonment is reversible: re-promote
 * the originating backlog item to rebuild the whole epic fresh. Never throws.
 */
async function abandonDeadlockedDependent(args: {
  buildId: string;
  parentEpicId: string | null;
  gate: Extract<FeatureBuildDependencyGateResult, { blocked: "unsatisfiable" }>;
}): Promise<PlanToBuildTransitionOutcome> {
  const { buildId, gate } = args;
  const deadDependencyBuildIds = gate.deadDependencies.map((d) => d.buildId);
  const reason = gate.message;
  try {
    // Re-check under the write: only abandon a build still in `plan` and not
    // already terminal, so a build that advanced or was abandoned between the
    // gate read and here is left untouched.
    await prisma.$transaction(async (tx) => {
      const fresh = await tx.featureBuild.findUnique({
        where: { buildId },
        select: { phase: true, abandonedAt: true },
      });
      if (!fresh || fresh.abandonedAt || fresh.phase !== "plan") return;
      await tx.featureBuild.update({
        where: { buildId },
        data: {
          phase: "abandoned",
          abandonedAt: new Date(),
          abandonReason: reason,
        },
      });
      await tx.buildActivity.create({
        data: {
          buildId,
          tool: "resumeStrandedBuildsOnBoot",
          summary:
            `Abandoned at the plan→build dependency gate: ${reason} ` +
            `(dead sibling build(s): ${deadDependencyBuildIds.join(", ") || "none"}) (BI-7B6D7661).`,
        },
      });
    });
  } catch (err) {
    console.warn("[plan-to-build-transition] failed to abandon deadlocked dependent:", { buildId }, err);
  }
  return { kind: "dependency-unsatisfiable", reason, deadDependencyBuildIds };
}

// ── The single transition executor ───────────────────────────────────────────

/**
 * Take a plan-phase build whose plan is complete + reviewed and flip it into
 * `build` — the ONE place the plan→build side-effect lives. Runs the structural
 * phase gate, the dependency gate, and the WWMD kernel gate (fail-OPEN on
 * evaluator error, block on a genuine principle conflict), then initializes the
 * build branch BEFORE flipping the phase and auto-dispatches the build
 * orchestrator. A branch-init / sandbox failure is counted and escalated past the
 * threshold rather than looped forever. Never throws.
 */
export async function performPlanToBuildTransition(params: {
  buildId: string;
  userId: string;
  context?: { threadId?: string } | null;
}): Promise<PlanToBuildTransitionOutcome> {
  const { buildId, userId, context } = params;

  const build = await prisma.featureBuild.findUnique({
    where: { buildId },
    select: {
      phase: true,
      plan: true,
      buildPlan: true,
      planReview: true,
      id: true,
      buildId: true,
      title: true,
      kind: true,
      parentEpicId: true,
      deliberationSummary: true,
      buildExecState: true,
      dependenciesOut: FEATURE_BUILD_DEPENDENCY_GATE_SELECT.dependenciesOut,
    },
  });
  if (!build) return { kind: "not-ready", reason: "build not found" };
  if (build.phase !== "plan" || !canTransitionPhase("plan", "build")) {
    return { kind: "not-ready", reason: `build is in phase ${build.phase}, not plan` };
  }
  const initiativeReadiness = await enforceBuildInitiativeReadiness({
    buildId,
    target: "implementation",
    targetPhase: "build",
    expectedPhase: "plan",
  });
  if (!initiativeReadiness.allowed) {
    logBuildActivity(buildId, "phase:gate-blocked", initiativeReadiness.message);
    return { kind: "gate-blocked", reason: initiativeReadiness.message };
  }

  // Already escalated → do not re-attempt the failing transition; keep the
  // resume loop cheap (a single DB read). Operator recovery: re-promote, or
  // restart the sandbox and manually advance.
  const tracker = readPlanAdvanceTracker(build.buildExecState);
  if (tracker?.escalatedAt) {
    return {
      kind: "escalated",
      reason: tracker.lastError ?? "prior plan→build transition failures",
      failures: tracker.failures,
    };
  }

  // Structural phase gate.
  const planRec = (build.plan as Record<string, unknown> | null) ?? {};
  const gate = await checkBuildPhaseGate({
    buildId,
    from: "plan",
    to: "build",
    evidence: {
      kind: build.kind,
      processSize: (planRec.processSize as string | undefined) ?? "medium",
      deliverableSensitivity: planRec.deliverableSensitivity,
      qualityFirst: planRec.qualityFirst === true,
      buildPlan: build.buildPlan,
      planReview: build.planReview,
      happyPathState: normalizeHappyPathState(planRec.happyPathState),
    },
  });
  if (!gate.allowed) {
    logBuildActivity(buildId, "phase:gate-blocked", gate.reason ?? "plan→build gate not satisfied");
    return { kind: "gate-blocked", reason: gate.reason ?? "plan→build gate not satisfied" };
  }

  // Dependency gate (blocking upstream builds).
  const dependencyGate = deriveFeatureBuildDependencyGate(build);
  if (!dependencyGate.allowed) {
    // A dead (abandoned/failed) upstream can NEVER complete, so this dependent
    // is deadlocked — and decomposition children are exempt from the 7-day
    // age-out, so nothing else would ever reap it. Terminally abandon it here
    // with a reason that names the dead sibling(s), instead of re-queuing the
    // "Waiting on: …" skip forever (BI-7B6D7661).
    if (dependencyGate.blocked === "unsatisfiable") {
      return abandonDeadlockedDependent({
        buildId,
        parentEpicId: build.parentEpicId,
        gate: dependencyGate,
      });
    }
    logBuildActivity(buildId, "phase:gate-blocked", dependencyGate.message);
    return { kind: "gate-blocked", reason: dependencyGate.message };
  }

  // WWMD kernel gate. Structural gates above are necessary but not sufficient:
  // principle_decide is the authority on whether plan→build honors platform
  // principles. The legacy/off path retains its fail-open behavior; an
  // enforce-mode autonomous lane fails closed because it has no operator at
  // the seam to interpret a missing decision oracle.
  let decisionOutcome: DecisionOutcomeType = "recommend";
  let executionProfileRef: AutonomousBuildExecutionProfileRefV1 | null = null;
  const { getAutonomousPlaybookMode } = await import(
    "@/lib/build/build-studio-config"
  );
  const autonomousMode = getAutonomousPlaybookMode();
  try {
    const { evaluateBuildStudioPlanAdvancementGate } = await import(
      "@/lib/decision-perspective/build-studio-gate"
    );
    const sensitivity =
      planRec.deliverableSensitivity === "elevated"
      || planRec.deliverableSensitivity === "high"
        ? planRec.deliverableSensitivity
        : "low";
    const { deriveTransitionRiskTier } = await import(
      "@/lib/decision-perspective/graduated-autonomy"
    );
    const decisionGate = await evaluateBuildStudioPlanAdvancementGate({
      db: prisma,
      build: {
        buildId: build.buildId,
        title: build.title ?? build.buildId,
        phase: "plan",
        planReview: build.planReview as Parameters<
          typeof evaluateBuildStudioPlanAdvancementGate
        >[0]["build"]["planReview"],
        deliberationSummary: build.deliberationSummary as Parameters<
          typeof evaluateBuildStudioPlanAdvancementGate
        >[0]["build"]["deliberationSummary"],
      },
      triggeredByUserId: userId,
      // BI-70280889: the acumen consults are keyed off these paths; without
      // them deriveImpactedAcumens sees an empty set and the layer stays inert.
      plannedFilePaths: await resolvePlannedFilePaths({
        db: prisma,
        buildId: build.buildId,
        buildRowId: build.id,
      }),
      ...(autonomousMode !== "off"
        ? {
            riskTier: deriveTransitionRiskTier({
              sensitivity,
              transition: "plan-advance",
            }),
          }
        : {}),
    });
    if (!decisionGate.allowed && autonomousMode !== "shadow") {
      logBuildActivity(
        buildId,
        "wwmd:gate-blocked",
        decisionGate.operatorMessage ?? "Decision kernel withheld plan→build advancement.",
      );
      return {
        kind: "wwmd-withheld",
        reason: decisionGate.operatorMessage ?? "decision kernel withheld advancement",
      };
    }
    decisionOutcome =
      decisionGate.evaluation?.outcomeType
      ?? (decisionGate.allowed ? "recommend" : "defer");
    if (!decisionGate.allowed) {
      logBuildActivity(
        buildId,
        "autonomous_playbook_shadow",
        `Shadow plan gate would withhold advancement: ${decisionGate.operatorMessage}.`,
      );
    }
  } catch (wwmdErr) {
    console.error("[plan-to-build-transition] WWMD gate errored (failing open):", wwmdErr);
    if (autonomousMode === "enforce") {
      logBuildActivity(
        buildId,
        "autonomous:needs-decision",
        "Autonomous plan advancement parked because the decision oracle was unavailable.",
      );
      return {
        kind: "wwmd-withheld",
        reason: "autonomous decision oracle unavailable",
      };
    }
  }

  if (autonomousMode !== "off") {
    try {
      const { resolveAutonomousBuildPhaseEligibility } = await import(
        "@/lib/build/autonomous-build-phase-runtime"
      );
      const autonomy = await resolveAutonomousBuildPhaseEligibility({
        buildId,
        checkpoint: "plan",
        gateOutcome: decisionOutcome,
      });
      executionProfileRef = autonomy.executionProfileRef;
      if (autonomousMode === "enforce" && !autonomy.mayAct) {
        const reason =
          autonomy.eligibility.blockers.join(", ")
          || "autonomous plan advancement is not evidence-cleared";
        logBuildActivity(
          buildId,
          "autonomous:needs-decision",
          `Plan advancement parked: ${reason}.`,
        );
        return { kind: "wwmd-withheld", reason };
      }
    } catch (error) {
      if (autonomousMode === "enforce") {
        const reason = `autonomous eligibility unavailable: ${String(
          error instanceof Error ? error.message : error,
        ).slice(0, 180)}`;
        logBuildActivity(buildId, "autonomous:needs-decision", reason);
        return { kind: "wwmd-withheld", reason };
      }
    }
  }

  // Initialize the build branch BEFORE flipping the phase so `buildBranch` is
  // always paired with `phase=build`. This is the step that was failing (sandbox
  // down / churning) and looping the whole fleet — count + escalate instead.
  try {
    const { isSandboxAvailable, startBuildBranch } = await import(
      "@/lib/build/sandbox/build-branch"
    );
    if (!(await isSandboxAvailable())) {
      return await failTransition({
        buildId,
        parentEpicId: build.parentEpicId ?? null,
        reason: "sandbox not running",
        prevTracker: tracker,
      });
    }
    await startBuildBranch(buildId);
  } catch (branchErr) {
    return await failTransition({
      buildId,
      parentEpicId: build.parentEpicId ?? null,
      reason: `startBuildBranch failed: ${(branchErr as Error).message?.slice(0, 200)}`,
      prevTracker: tracker,
    });
  }

  // Branch ready → phase-run bookkeeping, flip, dispatch.
  const { completeBuildPhaseRun, startBuildPhaseRun } = await import(
    "@/lib/build/build-phase-run"
  );
  void completeBuildPhaseRun(buildId, "plan");
  // swallow QuiescingError thrown during a self-upgrade drain (BI-QUIESCE-005)
  void startBuildPhaseRun(buildId, "build", {
    ...(executionProfileRef ? { executionProfileRef } : {}),
  }).catch(() => {});
  if (context?.threadId) {
    const { persistPhaseHandoffSummary } = await import("@/lib/build/phase-compaction-wire");
    void persistPhaseHandoffSummary(context.threadId, "plan");
  }
  await prisma.featureBuild.update({ where: { buildId }, data: { phase: "build" } });
  if (context?.threadId) {
    const { agentEventBus } = await import("@/lib/agent-event-bus");
    agentEventBus.emit(context.threadId, { type: "phase:change", buildId, phase: "build" });
  }
  logBuildActivity(buildId, "phase:advance", "Phase advanced: plan → build (buildBranch initialized)");
  await clearPlanAdvanceTracker(buildId, build.buildExecState);

  // Auto-dispatch the build orchestrator (fire-and-forget) so specialist code
  // generation runs immediately without waiting for an operator prompt.
  void import("@/lib/build/build-on-plan-approval").then((m) =>
    m
      .dispatchBuildForApprovedPlan({ buildId, userId })
      .catch((err) => console.error("[build-on-plan-approval] auto-dispatch failed:", err)),
  );

  return { kind: "advanced" };
}
