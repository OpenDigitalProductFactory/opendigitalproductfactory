// apps/web/lib/integrate/ship-on-review-approval.ts
//
// Auto-dispatch the Ship phase (deploy_feature + PR creation) when the Build
// Studio review verification completes with status="complete" or "skipped".
//
// Why this exists:
//   build-review-verification.ts runs UX tests and sets uxVerificationStatus
//   but does nothing else when verification passes. The operator must open the
//   build UI and click "Ship" to trigger deploy_feature + shipBuild. This is
//   the final human gate in the BS pipeline and is unnecessary for builds where
//   UX verification passes automatically.
//
// Behavior:
//   - Fires fire-and-forget from build-review-verification.ts's persist-results
//     step when uxVerificationStatus becomes "complete" or "skipped".
//   - Calls deploy_feature (extracts sandbox diff + categorizes) via executeTool.
//   - If deploy succeeds, calls shipBuild (creates PR, stamps acceptance criteria).
//   - Idempotent: skips if phase is already "ship" or build has a diffPatch.
//   - Never throws — all errors logged as BuildActivity rows.
//
// After this, the Build Studio flow is:
//   Approve Start → Ideate → Plan → Build → Review Verification → deploy_feature (diff extracted)
//   → Operator reviews diff + clicks "Ship to GitHub" (the one remaining intentional human gate)
// The PR creation requires an intentional human decision for the first iteration.
// Once operators have reviewed a few cycles, this gate can be made opt-out.

import { prisma } from "@dpf/db";

function logBuildActivity(buildId: string, tool: string, summary: string): Promise<void> {
  return prisma.buildActivity.create({ data: { buildId, tool, summary } }).then(() => void 0).catch(() => void 0);
}

type ShipDispatchOutcome =
  | { kind: "skipped"; reason: string }
  | { kind: "dispatched-success"; prUrl?: string; durationMs: number }
  | { kind: "dispatched-failure"; error: string; durationMs: number };

/**
 * Auto-dispatch the ship phase for a build whose review verification just
 * completed. Designed to be called fire-and-forget; never throws.
 */
export async function dispatchShipForVerifiedBuild(params: {
  buildId: string;
  userId: string;
  verificationStatus: "complete" | "skipped";
}): Promise<ShipDispatchOutcome> {
  const { buildId, userId, verificationStatus } = params;
  const t0 = Date.now();

  const log = (summary: string) =>
    logBuildActivity(buildId, "ship_dispatch", summary);

  try {
    // 1. Fetch current build state.
    const build = await prisma.featureBuild.findUnique({
      where: { buildId },
      select: {
        phase: true,
        diffPatch: true,
        buildBranch: true,
        sandboxId: true,
        title: true,
        kind: true,
        createdById: true,
      },
    });

    if (!build) {
      await log(`Build not found: ${buildId}`);
      return { kind: "dispatched-failure", error: "Build not found", durationMs: Date.now() - t0 };
    }

    // Idempotency guards.
    if (build.phase === "ship") {
      await log("Skipped — already in ship phase");
      return { kind: "skipped", reason: "already in ship phase" };
    }
    if (build.phase !== "review") {
      await log(`Skipped — phase is ${build.phase}, expected review`);
      return { kind: "skipped", reason: `phase=${build.phase}` };
    }
    if (build.diffPatch && build.diffPatch.trim().length > 0) {
      // deploy_feature already extracted the diff on a prior cycle, but the
      // phase was never advanced — deploy_feature extracts the diff; it does
      // NOT flip the phase. Advance review→ship now instead of skipping.
      // Otherwise the review-phase reconciler (resumeStrandedBuildsOnBoot)
      // re-enters here every tick, hits this branch, and the build loops at
      // review forever, never shipping (observed live on FB-FD850A2C: a
      // ~20-min resume→review-verification→ship-dispatch-skip cycle).
      return advanceReviewedBuildToShip(buildId, log, t0);
    }
    if (!build.sandboxId) {
      await log("Skipped — no sandbox (nothing to ship)");
      return { kind: "skipped", reason: "no sandbox" };
    }
    if (!build.buildBranch) {
      await log("Skipped — no build branch (start_build never completed)");
      return { kind: "skipped", reason: "no buildBranch" };
    }

    // Use the build's creator as the actor for deploy_feature + shipBuild,
    // since they are the authority for this build's ship action.
    const actorUserId = build.createdById ?? userId;

    await log(`Auto-dispatching ship: verificationStatus=${verificationStatus}`);

    // 2. Run deploy_feature via executeTool — extracts diff, runs impact
    //    analysis, advances phase to ship.
    const { executeTool } = await import("@/lib/mcp-tools");
    const deployResult = await executeTool(
      "deploy_feature",
      { buildId },
      actorUserId,
      { featureBuildId: buildId },
    );

    if (!deployResult.success) {
      const msg = `deploy_feature failed: ${String(deployResult.message ?? deployResult.error ?? "unknown").slice(0, 300)}`;
      await log(msg);
      return { kind: "dispatched-failure", error: msg, durationMs: Date.now() - t0 };
    }

    await log("deploy_feature succeeded — diff extracted.");

    // deploy_feature extracts the diff but does NOT advance the phase. Advance
    // review→ship here (the documented post-condition of this dispatcher) and
    // attempt ship→complete. Pushing to GitHub stays a human gate, surfaced in
    // the Review panel — unless the ship forks are already terminal + deployed,
    // in which case reconcileBuildCompletion finishes the build.
    return advanceReviewedBuildToShip(buildId, log, t0);
  } catch (err) {
    const msg = String(err instanceof Error ? err.message : err).slice(0, 300);
    try { await log(`Ship dispatch failed: ${msg}`); } catch (_) { /**/ }
    return { kind: "dispatched-failure", error: msg, durationMs: Date.now() - t0 };
  }
}

/**
 * Advance a review-phase build (whose diff is already extracted) to the ship
 * phase, then attempt ship→complete.
 *
 * Why this exists: `deploy_feature` extracts the sandbox diff but does NOT flip
 * the phase, and the original dispatcher assumed it did ("phase advanced to
 * ship"). The phase therefore stayed at `review`, so on every reconciler tick
 * `dispatchShipForVerifiedBuild` re-ran, saw the diff, and skipped — the build
 * looped at review forever and never shipped. This restores the dispatcher's
 * documented post-condition (advance to ship) as an explicit, gated step.
 *
 * The review→ship advance is gated by the policy `checkPhaseGate` (the same
 * gate the admin advance-phase route enforces) and flipped with a phase-guarded
 * `updateMany`, so a concurrent reconciler/live-advance can never double-advance.
 * Pushing to GitHub remains a human gate; this only parks the build at ship —
 * unless `reconcileBuildCompletion` finds the ship forks already terminal and
 * the merge SHA deployed, in which case it finishes the build (ship→complete).
 * Never throws.
 */
export async function advanceReviewedBuildToShip(
  buildId: string,
  log: (summary: string) => Promise<void>,
  t0: number,
): Promise<ShipDispatchOutcome> {
  const build = await prisma.featureBuild.findUnique({
    where: { buildId },
    select: {
      phase: true,
      kind: true,
      brief: true,
      designDoc: true,
      designReview: true,
      plan: true,
      buildPlan: true,
      planReview: true,
      verificationOut: true,
      acceptanceMet: true,
      threadId: true,
    },
  });

  if (!build) {
    return { kind: "dispatched-failure", error: "Build not found", durationMs: Date.now() - t0 };
  }
  if (build.phase !== "review") {
    // Another path (live advance / a prior tick) already moved it on.
    return { kind: "skipped", reason: `phase=${build.phase}` };
  }

  const { checkPhaseGate, canTransitionPhase, normalizeHappyPathState } = await import(
    "@/lib/feature-build-types"
  );
  if (!canTransitionPhase("review", "ship")) {
    return { kind: "skipped", reason: "transition not allowed" };
  }

  const brief = build.brief as { fixContext?: unknown } | null;
  const gate = checkPhaseGate("review", "ship", {
    kind: build.kind,
    fixContext: brief?.fixContext,
    designDoc: build.designDoc,
    designReview: build.designReview,
    happyPathState: normalizeHappyPathState(
      (build.plan as Record<string, unknown> | null)?.happyPathState ?? null,
    ),
    buildPlan: build.buildPlan,
    planReview: build.planReview,
    verificationOut: build.verificationOut,
    acceptanceMet: build.acceptanceMet,
  });
  if (!gate.allowed) {
    await log(`Not advanced — review→ship gate: ${gate.reason ?? "blocked"}`);
    return { kind: "skipped", reason: gate.reason ?? "review→ship gate blocked" };
  }

  // Phase-guarded flip: only advance if STILL at review, so two concurrent
  // reconcilers (or a live advance racing this) never double-advance.
  const flipped = await prisma.featureBuild.updateMany({
    where: { buildId, phase: "review" },
    data: { phase: "ship" },
  });
  if (flipped.count === 0) {
    return { kind: "skipped", reason: "already advanced" };
  }
  await log(
    "Advanced review→ship (diff already extracted). Push to GitHub remains a human gate.",
  );

  // Best-effort: live UI update.
  try {
    if (build.threadId) {
      const { agentEventBus } = await import("@/lib/agent-event-bus");
      agentEventBus.emit(build.threadId, { type: "phase:change", buildId, phase: "ship" });
    }
  } catch {
    /* best-effort */
  }

  // If the ship forks are already terminal (private/fork-only mode, or the PR
  // has merged) AND the deployed runtime carries the merge SHA, finish now.
  try {
    const { reconcileBuildCompletion } = await import("@/lib/build-flow-state");
    if (await reconcileBuildCompletion(buildId)) {
      await log("Ship forks terminal + deployed — advanced ship→complete.");
    }
  } catch (err) {
    await log(
      `ship→complete check failed: ${String(err instanceof Error ? err.message : err).slice(0, 200)}`,
    );
  }

  return { kind: "dispatched-success", durationMs: Date.now() - t0 };
}
