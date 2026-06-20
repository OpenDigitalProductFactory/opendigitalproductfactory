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
//
// There is no session on boot, so the caller passes the build's createdById as
// the actor for the dispatch/review calls.

import { prisma } from "@dpf/db";

export type ResumePreBuildOutcome =
  | { kind: "resumed"; phase: string; via: string; detail: string }
  | { kind: "skipped"; phase: string; reason: string }
  | { kind: "failed"; phase: string; error: string };

function hasPlanTasks(buildPlan: unknown): boolean {
  const plan = buildPlan as { tasks?: unknown[] } | null;
  return Array.isArray(plan?.tasks) && plan!.tasks!.length > 0;
}

function hasDesignDoc(designDoc: unknown): boolean {
  return designDoc != null && typeof designDoc === "object" && Object.keys(designDoc as object).length > 0;
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
      select: { designDoc: true, buildPlan: true, planReview: true },
    });
    if (!build) {
      return { kind: "failed", phase, error: "build not found" };
    }

    if (phase === "ideate") {
      if (!hasDesignDoc(build.designDoc)) {
        // No design doc yet — re-dispatch ideate research to generate it. The
        // dispatcher auto-runs reviewDesignDoc, which advances ideate->plan.
        const { dispatchIdeateForApprovedBuild } = await import("@/lib/integrate/ideate-on-approval");
        const outcome = await dispatchIdeateForApprovedBuild({ buildId, userId });
        return { kind: "resumed", phase, via: "dispatchIdeateForApprovedBuild", detail: outcome.kind };
      }
      // Design doc exists but the build never advanced — re-run the canonical
      // design review (auto-advances ideate->plan when the gate is satisfied).
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
