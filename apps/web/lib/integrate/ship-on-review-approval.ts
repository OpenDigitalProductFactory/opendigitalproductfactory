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
      await log("Skipped — diff already extracted (deploy_feature ran)");
      return { kind: "skipped", reason: "diff already extracted" };
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

    await log("deploy_feature succeeded — diff extracted, phase advanced to ship");

    // deploy_feature extracted the diff and advanced the phase to "ship".
    // The operator can now see the diff in the Build Studio review panel and
    // click "Ship to GitHub" — the one remaining intentional human gate.
    // (PR creation requires a deliberate human decision for the first iteration.)
    await log("deploy_feature succeeded — diff extracted, phase=ship, awaiting operator review");
    return {
      kind: "dispatched-success",
      durationMs: Date.now() - t0,
    };
  } catch (err) {
    const msg = String(err instanceof Error ? err.message : err).slice(0, 300);
    try { await log(`Ship dispatch failed: ${msg}`); } catch (_) { /**/ }
    return { kind: "dispatched-failure", error: msg, durationMs: Date.now() - t0 };
  }
}
