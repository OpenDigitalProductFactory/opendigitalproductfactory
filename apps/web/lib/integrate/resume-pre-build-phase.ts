// apps/web/lib/integrate/resume-pre-build-phase.ts
//
// Auto-resume a Build Studio build that was stranded in a NON-terminal
// pre-build phase (ideate / plan / review) by a restart or a self-upgrade swap
// (BI-9257CF19).
//
// Background:
//   resumeStrandedBuildsOnBoot (apps/web/instrumentation.ts) re-dispatches builds
//   stranded in the `build` phase via the buildExecState step-machine. The
//   pre-build phases are dispatch-driven (fire-and-forget) with no step-machine,
//   so a swap that kills the in-flight dispatch used to leave them flagged-for-
//   operator and otherwise stuck forever ("Stranded in plan phase after a
//   restart/swap"). This module re-fires the CANONICAL generator/reviewer for
//   each pre-build phase so the build resumes automatically — the resume-after
//   half of the self-upgrade quiescence/resume contract.
//
// Idempotency + safety:
//   - The caller only invokes this for builds whose `updatedAt` is older than a
//     staleness cutoff, so a legitimately in-flight build on a still-running
//     portal is never touched.
//   - Each underlying dispatcher carries its own idempotency guard
//     (dispatchIdeateForApprovedBuild skips when a designDoc exists;
//     dispatchPlanForApprovedBuild skips when a buildPlan exists). When the
//     artifact already exists we re-run the phase's REVIEW instead, which is the
//     step that actually advances the phase — and which now reflects current
//     reviewer logic (e.g. the #1976/#1998 chore test-first lenience), so a
//     review that failed pre-fix can pass on resume.
//   - Never throws; returns a structured outcome for BuildActivity logging.
//   - Decompose-gate park (BI-BD4F2D0D): an ideate build whose design PASSED
//     review but is sized `decompose-required` with no override is parked at the
//     Phase-4b decomposition gate, not stranded. The resume path detects this
//     and refuses to re-dispatch ideate / re-run reviewDesignDoc (both just
//     re-fire the gate and loop, burning cloud AI spend). It instead proposes
//     decomposition candidates ONCE so the operator can approve_decomposition or
//     record_decomposition_override, then parks. See isParkedAtDecomposeGate.
//
// There is no session on boot, so the caller passes the build's createdById as
// the actor for the dispatch/review calls.

import { prisma } from "@dpf/db";
import {
  isHappyPathIntakeReady,
  normalizeHappyPathState,
} from "@/lib/feature-build-types";

export type ResumePreBuildOutcome =
  | { kind: "resumed"; phase: string; via: string; detail: string }
  | { kind: "skipped"; phase: string; reason: string }
  | { kind: "failed"; phase: string; error: string };

/**
 * Age-out cap for a build stranded in a NON-terminal PRE-BUILD phase
 * (ideate/plan/review). A build created this long ago that is STILL in a
 * pre-build phase has failed to progress for a week — these phases resolve in
 * minutes-to-hours, not days — so it is aged out to `abandoned` instead of
 * being auto-resumed forever (BI-A009313E). Override with
 * BUILD_STRANDED_ABANDON_MS.
 *
 * Keyed on `createdAt`, NOT `updatedAt` or a TaskRun heartbeat: auto-resume
 * itself writes BuildActivity (and can bump updatedAt / mint fresh heartbeats),
 * so an updatedAt/heartbeat signal is defeated by the very loop we are trying to
 * break — it is exactly why the quiescence dead-phase reaper cannot clear these
 * (they always look "alive"). `createdAt` never moves, so the cap is immune to
 * resume re-heartbeating.
 *
 * Default 7 days: a full week survives the operator being away plus the weekly
 * rate-limit reset (see feedback: idle-is-not-abandoned), so genuinely
 * operator-paused work — e.g. a build correctly parked awaiting a decomposition
 * decision — is never abandoned prematurely. Abandonment is reversible:
 * re-promote the backlog item to retry.
 */
export const STRANDED_ABANDON_MS =
  Number(process.env.BUILD_STRANDED_ABANDON_MS) || 7 * 24 * 60 * 60 * 1000;

/**
 * Pre-build phases that have a canonical generator/reviewer resume path but no
 * `build`-phase step-machine. These are the phases the age-out cap governs; the
 * `build` phase keeps its proven step-machine resume and is intentionally NOT
 * aged out here.
 */
export const RESUMABLE_PRE_BUILD_PHASES = ["ideate", "plan", "review"] as const;

function isResumablePreBuildPhase(phase: string): boolean {
  return (RESUMABLE_PRE_BUILD_PHASES as readonly string[]).includes(phase);
}

/**
 * Pure decision: has a pre-build strand outlived the resume cap and should be
 * aged out to `abandoned` instead of resumed again? No DB; unit-tested.
 *
 * Abandonable only when the build is in a resumable pre-build phase
 * (ideate/plan/review — NOT `build`, which resumes via its step-machine), is not
 * an epic-decomposed child (those are coordinated by the parent epic, not reaped
 * here), and was created longer ago than the threshold.
 */
export function isStrandedPreBuildAbandonable(args: {
  phase: string;
  createdAt: Date;
  parentEpicId: string | null;
  now: Date;
  thresholdMs: number;
}): boolean {
  const { phase, createdAt, parentEpicId, now, thresholdMs } = args;
  if (parentEpicId) return false;
  if (!isResumablePreBuildPhase(phase)) return false;
  return now.getTime() - createdAt.getTime() > thresholdMs;
}

/**
 * DB helper: age a stranded pre-build build out to `abandoned` so it leaves the
 * resume candidate set for good — stopping the per-swap re-churn — and its open
 * BuildPhaseRun is closed by quiescence's reconcileTerminalBuildPhaseRuns.
 *
 * Transactional + idempotent: re-checks under the row so a build that just came
 * alive (advanced past the pre-build phase, or was abandoned by a concurrent
 * sweep) between scan and write is left untouched. Returns true iff it abandoned
 * the row. Never throws (best-effort maintenance).
 */
export async function abandonStrandedPreBuild(params: {
  buildId: string;
  phase: string;
  ageMs: number;
  now?: Date;
}): Promise<boolean> {
  const { buildId, phase, ageMs } = params;
  const now = params.now ?? new Date();
  const days = Math.max(1, Math.round(ageMs / 86_400_000));
  try {
    return await prisma.$transaction(async (tx) => {
      const fresh = await tx.featureBuild.findUnique({
        where: { buildId },
        select: { phase: true, abandonedAt: true },
      });
      // Already terminal/abandoned, or advanced out of a pre-build phase since
      // the scan — nothing to do.
      if (!fresh || fresh.abandonedAt || !isResumablePreBuildPhase(fresh.phase)) {
        return false;
      }
      await tx.featureBuild.update({
        where: { buildId },
        data: {
          phase: "abandoned",
          abandonedAt: now,
          abandonReason:
            `Auto-aged-out: stranded in ${phase} phase for >${days}d with no progress. ` +
            `Capped the perpetual build-resume loop — each portal swap re-resumed it, ` +
            `re-stranding it on the next upgrade (BI-A009313E). Re-promote the backlog item to retry.`,
        },
      });
      await tx.buildActivity.create({
        data: {
          buildId,
          tool: "resumeStrandedBuildsOnBoot",
          summary:
            `Aged out stranded ${phase} build to abandoned (>${days}d old, no progress) — ` +
            `capped the auto-resume loop (BI-A009313E). Re-promote the backlog item to retry.`,
        },
      });
      return true;
    });
  } catch (err) {
    console.warn(`[build-resume] failed to age out stranded build ${buildId}:`, err);
    return false;
  }
}

function hasPlanTasks(buildPlan: unknown): boolean {
  const plan = buildPlan as { tasks?: unknown[] } | null;
  return Array.isArray(plan?.tasks) && plan!.tasks!.length > 0;
}

function hasDesignDoc(designDoc: unknown): boolean {
  return designDoc != null && typeof designDoc === "object" && Object.keys(designDoc as object).length > 0;
}

/** Subset of the persisted designReview JSON the decompose-gate guard reads. */
type DesignReviewForGate = {
  decision?: string;
  sizeAssessment?: { decision?: string } | null;
  decompositionOverride?: unknown;
  decompositionCandidates?: { latest?: unknown } | null;
} | null;

/**
 * True when a build's persisted designReview shows it is parked at the Phase-4b
 * `decompose-required` gate: the design PASSED review, the deterministic size
 * assessment is `decompose-required`, and no operator override was recorded.
 * This mirrors the exact gate condition in reviewDesignDoc
 * (apps/web/lib/mcp-tools.ts — `decomposeDecision === "decompose-required" &&
 * !hasOverride`) so the resume path and the gate agree on what "parked" means.
 *
 * Such a build is NOT stranded — it is waiting on a human (`approve_decomposition`
 * or `record_decomposition_override`). Re-dispatching ideate (≈847s of cloud
 * ChatGPT/Codex spend) or re-running reviewDesignDoc on it just regenerates /
 * re-reviews an already-passed design and re-computes the same verdict, re-firing
 * the gate and looping forever (FB-7930340F burned real AI quota this way for
 * ~2 days). Only `decompose-required` blocks the gate; `decompose-recommended`
 * advances to Plan on review, so it is intentionally NOT treated as parked here.
 */
function isParkedAtDecomposeGate(dr: DesignReviewForGate): boolean {
  return (
    dr?.decision === "pass" &&
    dr?.sizeAssessment?.decision === "decompose-required" &&
    dr?.decompositionOverride == null
  );
}

/** True when decomposition candidates have already been proposed for this build. */
function hasDecompositionCandidates(dr: DesignReviewForGate): boolean {
  const latest = dr?.decompositionCandidates?.latest;
  return Array.isArray(latest) && latest.length > 0;
}

/**
 * Re-fire the canonical generator/reviewer for a build stranded in a pre-build
 * phase. Fire-and-forget friendly: awaits internally but never throws.
 *
 * @param buildId  FB-* semantic build id
 * @param phase    the stranded phase — one of ideate | plan | review
 * @param userId   actor for the dispatch/review (build.createdById on boot)
 */
export async function resumePreBuildPhase(params: {
  buildId: string;
  phase: string;
  userId: string;
}): Promise<ResumePreBuildOutcome> {
  const { buildId, phase, userId } = params;

  try {
    if (phase === "review") {
      // Review phase = build-review-verification (UX tests + verification gate).
      // Re-queue it; the queue function persists results and fires the
      // ship-on-review-approval follow-on when it passes.
      const { queueBuildReviewVerification } = await import("@/lib/build-review-verification-trigger");
      await queueBuildReviewVerification(buildId);
      return { kind: "resumed", phase, via: "queueBuildReviewVerification", detail: "re-queued review verification" };
    }

    const build = await prisma.featureBuild.findUnique({
      where: { buildId },
      select: {
        designDoc: true,
        buildPlan: true,
        planReview: true,
        designReview: true,
        plan: true,
        originatingBacklogItemId: true,
        parentEpicId: true,
      },
    });
    if (!build) {
      return { kind: "failed", phase, error: "build not found" };
    }

    if (phase === "ideate") {
      // ── Decompose-gate park guard (BI-BD4F2D0D) ──────────────────────────
      // A build whose design PASSED review but whose deterministic size
      // assessment is `decompose-required` (with no operator override) is NOT
      // stranded — it is correctly parked at the Phase-4b decomposition gate,
      // waiting on a human to call approve_decomposition or
      // record_decomposition_override. Resuming it the normal way re-dispatches
      // ideate (≈847s of cloud spend) when the doc is missing, or re-runs
      // reviewDesignDoc when it is present; either way it regenerates /
      // re-reviews an already-passed design, re-computes the same
      // decompose-required verdict, and re-fires the gate — an infinite
      // resume↔gate-block↔stall loop that burned real ChatGPT/Codex quota for
      // ~2 days on FB-7930340F. Recognize the parked state up front: ensure the
      // operator has candidates to act on (propose ONCE, idempotently), then
      // STOP — never re-run expensive pre-build work for a build whose only
      // blocker is a pending human decision.
      const designReviewForGate = build.designReview as DesignReviewForGate;
      if (isParkedAtDecomposeGate(designReviewForGate)) {
        // Governed-backlog autopilot (BI-C4F828B7): rather than park an
        // auto-promoted build here forever (nobody clicks approve on an
        // unattended install → the daily tee-up keeps minting more), resolve
        // the gate autonomously — the same path reviewDesignDoc now takes. This
        // is what actually drains the parked-ideate backlog: the reviewDesignDoc
        // gate only fires for builds flowing through review, but a build that is
        // ALREADY parked is short-circuited here on every resume and never
        // reaches that gate. Operator-driven / non-governed builds fall through
        // to the original propose-once-and-park behavior below.
        let overriddenMonolithic = false;
        const governedConfig = await prisma.platformDevConfig.findUnique({
          where: { id: "singleton" },
          select: { governedBacklogEnabled: true },
        });
        if (
          governedConfig?.governedBacklogEnabled === true &&
          build.originatingBacklogItemId != null
        ) {
          const { autoResolveDecomposeRequiredGate } = await import(
            "@/lib/build/auto-resolve-decompose-gate"
          );
          const auto = await autoResolveDecomposeRequiredGate({
            build: {
              buildId,
              parentEpicId: build.parentEpicId ?? null,
              originatingBacklogItemId: build.originatingBacklogItemId ?? null,
              designReview: build.designReview,
            },
            userId,
            governedBacklogEnabled: true,
          });
          if (auto.action === "decomposed") {
            return {
              kind: "resumed",
              phase,
              via: "autoResolveDecomposeRequiredGate",
              detail: `auto-decomposed into ${auto.childBuildIds.length} child build(s) under Epic ${auto.epicId}`,
            };
          }
          if (auto.action === "overridden") {
            // Monolithic override recorded — the gate no longer blocks. Fall
            // through to the normal review re-run below, which now advances
            // ideate -> plan.
            overriddenMonolithic = true;
          }
        }
        if (overriddenMonolithic) {
          // Skip the park block; continue to the design-doc / review-rerun path.
        } else if (hasDecompositionCandidates(designReviewForGate)) {
          return {
            kind: "skipped",
            phase,
            reason:
              "design passed review but size=decompose-required and candidates already exist — parked awaiting approve_decomposition or record_decomposition_override (NOT re-dispatching ideate or re-running review).",
          };
        } else {
          // No candidates yet: generate them ONCE so the operator has something
          // to approve. This is the productive alternative to re-ideating — it
          // never throws (propose_build_decomposition returns a structured
          // ToolResult) and is self-idempotent (the branch above short-circuits
          // next time).
          const { executeTool } = await import("@/lib/mcp-tools");
          const result = await executeTool(
            "propose_build_decomposition",
            { buildId },
            userId,
            { featureBuildId: buildId },
          );
          const detail = result.success
            ? `proposed decomposition candidates for operator approval (${
                typeof result.message === "string" ? result.message.slice(0, 120) : "ok"
              })`
            : `propose_build_decomposition produced no candidates (${String(
                result.error ?? result.message ?? "unknown",
              ).slice(0, 120)}) — left parked for operator`;
          return {
            kind: "skipped",
            phase,
            reason: `design passed review but size=decompose-required — ${detail}; parked awaiting approve_decomposition or override (NOT re-dispatching ideate).`,
          };
        }
      }

      if (!hasDesignDoc(build.designDoc)) {
        // No design doc yet — re-dispatch ideate research to generate it. The
        // dispatcher auto-runs reviewDesignDoc, which advances ideate->plan.
        const { dispatchIdeateForApprovedBuild } = await import("@/lib/integrate/ideate-on-approval");
        const outcome = await dispatchIdeateForApprovedBuild({ buildId, userId });
        return { kind: "resumed", phase, via: "dispatchIdeateForApprovedBuild", detail: outcome.kind };
      }
      // Design doc exists. If its last review FAILED, run the design-review fix
      // loop — regenerate the designDoc with the reviewer's issues fed back,
      // re-review, escalate after N (the loop escalates kind=fix builds whose
      // "Incomplete fix diagnosis" a regen can't fix). Re-reviewing the same
      // rejected doc just re-fails forever (the live ideate jam). Otherwise
      // re-run the review (current reviewer logic may now pass an older verdict).
      const designReviewFailed =
        (build.designReview as { decision?: string } | null)?.decision === "fail";
      if (designReviewFailed) {
        const { dispatchDesignReviewFixLoop } = await import("@/lib/integrate/ideate-on-approval");
        const outcome = await dispatchDesignReviewFixLoop({ buildId, userId });
        return { kind: "resumed", phase, via: "dispatchDesignReviewFixLoop", detail: outcome.kind };
      }
      // BI-E212CAE2: when review already PASSed and plan.happyPathState is
      // present but still incomplete, re-running reviewDesignDoc cannot clear a
      // STATIC completeness gate — park for the operator instead of looping
      // (burned cloud quota on FB-A500CCE6). If happyPathState is absent, re-run
      // review so auto-intake can populate epic/backlog/goal/taxonomy once.
      const designPassed =
        (build.designReview as { decision?: string } | null)?.decision === "pass";
      if (designPassed) {
        const planRec = (build as { plan?: unknown }).plan as Record<string, unknown> | null | undefined;
        const rawHps = planRec?.happyPathState;
        if (rawHps != null) {
          const happy = normalizeHappyPathState(rawHps);
          if (!isHappyPathIntakeReady(happy)) {
            return {
              kind: "skipped",
              phase,
              reason:
                "design passed review but intake is incomplete (taxonomy/backlog/epic/goal) — parked for operator (NOT re-running reviewDesignDoc; static gate).",
            };
          }
        }
      }
      const { executeTool } = await import("@/lib/mcp-tools");
      const result = await executeTool("reviewDesignDoc", { buildId }, userId, { featureBuildId: buildId });
      return {
        kind: "resumed",
        phase,
        via: "executeTool:reviewDesignDoc",
        detail: typeof result.message === "string" ? result.message.slice(0, 160) : "review complete",
      };
    }

    if (phase === "plan") {
      if (!hasPlanTasks(build.buildPlan)) {
        // No plan yet — re-dispatch plan generation. The dispatcher auto-runs
        // reviewBuildPlan, which advances plan->build when the gate is satisfied.
        const { dispatchPlanForApprovedBuild } = await import("@/lib/integrate/plan-on-approval");
        const outcome = await dispatchPlanForApprovedBuild({ buildId, userId });
        return { kind: "resumed", phase, via: "dispatchPlanForApprovedBuild", detail: outcome.kind };
      }
      // Plan exists. If its last review FAILED, REGENERATE via the fix loop —
      // re-reviewing the same bad plan just re-fails forever (the live jam: a plan
      // that "points at files that do not exist" stays stuck every resume). The
      // forceRegenerate path bypasses the idempotency guard so #2090's bounded
      // fix loop (with a fresh verified-paths search + escalation) repairs it.
      const planReviewFailed =
        (build.buildPlan != null) &&
        (build.planReview as { decision?: string } | null)?.decision === "fail";
      if (planReviewFailed) {
        const { dispatchPlanForApprovedBuild } = await import("@/lib/integrate/plan-on-approval");
        const outcome = await dispatchPlanForApprovedBuild({ buildId, userId, forceRegenerate: true });
        return { kind: "resumed", phase, via: "dispatchPlanForApprovedBuild:repair", detail: outcome.kind };
      }
      // No failed verdict — re-run the review (current reviewer logic may now pass
      // an older verdict); it auto-advances plan->build on pass.
      const { executeTool } = await import("@/lib/mcp-tools");
      const result = await executeTool("reviewBuildPlan", { buildId }, userId, { featureBuildId: buildId });
      return {
        kind: "resumed",
        phase,
        via: "executeTool:reviewBuildPlan",
        detail: typeof result.message === "string" ? result.message.slice(0, 160) : "review complete",
      };
    }

    return { kind: "skipped", phase, reason: `phase ${phase} is not a resumable pre-build phase` };
  } catch (err) {
    return {
      kind: "failed",
      phase,
      error: String(err instanceof Error ? err.message : err).slice(0, 240),
    };
  }
}
