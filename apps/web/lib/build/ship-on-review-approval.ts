// apps/web/lib/build/ship-on-review-approval.ts
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
import { enforceBuildInitiativeReadiness } from "@/lib/build/build-entry-gate";

import { resolveShippedFilePaths } from "@/lib/decision-perspective/planned-file-paths";

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
      id: true,
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
      uxTestResults: true,
      uxVerificationStatus: true,
      threadId: true,
      diffPatch: true,
      createdById: true,
      deliberationSummary: true,
    },
  });

  if (!build) {
    return { kind: "dispatched-failure", error: "Build not found", durationMs: Date.now() - t0 };
  }
  if (build.phase !== "review") {
    // Another path (live advance / a prior tick) already moved it on.
    return { kind: "skipped", reason: `phase=${build.phase}` };
  }

  let executionProfileRef: import(
    "@/lib/build/autonomous-build-eligibility-reader"
  ).AutonomousBuildExecutionProfileRefV1 | null = null;
  const { getAutonomousPlaybookMode } = await import("./build-studio-config");
  const autonomousMode = getAutonomousPlaybookMode();
  if (autonomousMode !== "off") {
    try {
      const { deriveBlastRadiusSensitivity } = await import("./change-impact");
      const actualSensitivity = await deriveBlastRadiusSensitivity(
        (build.diffPatch as string | null) ?? "",
      );
      const { evaluateBuildStudioShipGate } = await import(
        "@/lib/decision-perspective/build-studio-ship-gate"
      );
      const shipGate = await evaluateBuildStudioShipGate({
        db: prisma,
        build: {
          buildId,
          planReview: build.planReview as Parameters<
            typeof evaluateBuildStudioShipGate
          >[0]["build"]["planReview"],
          deliberationSummary: build.deliberationSummary as Parameters<
            typeof evaluateBuildStudioShipGate
          >[0]["build"]["deliberationSummary"],
        },
        sensitivity: actualSensitivity,
        triggeredByUserId: build.createdById,
        // BI-70280889: at ship time the realized diff is the truth about which
        // acumens this change impacts — better evidence than any plan.
        plannedFilePaths: await resolveShippedFilePaths({
          db: prisma,
          buildId,
          buildRowId: build.id,
          diffPatch: (build.diffPatch as string | null) ?? null,
        }),
      });
      if (!shipGate.allowed && autonomousMode === "enforce") {
        await log(
          shipGate.operatorMessage
          || "Needs your decision before this verified build can ship.",
        );
        return {
          kind: "skipped",
          reason: shipGate.operatorMessage || "graduated ship gate withheld",
        };
      }
      const { resolveAutonomousBuildPhaseEligibility } = await import(
        "@/lib/build/autonomous-build-phase-runtime"
      );
      const autonomy = await resolveAutonomousBuildPhaseEligibility({
        buildId,
        checkpoint: "ship",
        gateOutcome: shipGate.evaluation.outcomeType,
        sensitivityOverride: actualSensitivity,
      });
      executionProfileRef = autonomy.executionProfileRef;
      if (autonomousMode === "enforce" && !autonomy.mayAct) {
        const reason =
          autonomy.eligibility.blockers.join(", ")
          || "autonomous ship is not evidence-cleared";
        await log(`Needs your decision: ${reason}.`);
        return { kind: "skipped", reason };
      }
    } catch (error) {
      if (autonomousMode === "enforce") {
        const reason = `autonomous ship gate unavailable: ${String(
          error instanceof Error ? error.message : error,
        ).slice(0, 180)}`;
        await log(`Needs your decision: ${reason}.`);
        return { kind: "skipped", reason };
      }
    }
  }

  // Evidence-gated autonomous acceptance (kernel DI-53037C92BC0A, default-OFF
  // flag). It runs only after the autonomous ship gate above, so a high-risk or
  // authority-ceiling case cannot manufacture acceptance before escalating.
  try {
    const { autoAcceptBuildOnEvidence } = await import("@/lib/build/auto-accept");
    const auto = await autoAcceptBuildOnEvidence(buildId);
    if (auto.accepted) {
      await log(
        `Auto-recorded acceptance on green evidence (${auto.acceptanceMet?.length ?? 0} criteria) — evidence-gated autopilot.`,
      );
      build.acceptanceMet = auto.acceptanceMet as typeof build.acceptanceMet;
    }
  } catch {
    /* never blocks the manual/off path */
  }

  const { canTransitionPhase, normalizeHappyPathState } = await import(
    "@/lib/feature-build-types"
  );
  const { checkBuildPhaseGate } = await import("@/lib/work-posture/verification-depth-gate");
  if (!canTransitionPhase("review", "ship")) {
    return { kind: "skipped", reason: "transition not allowed" };
  }
  const readiness = await enforceBuildInitiativeReadiness({
    buildId, target: "implementation", targetPhase: "ship", expectedPhase: "review",
  });
  if (!readiness.allowed) {
    await log(`Not advanced — ${readiness.message}`);
    return { kind: "skipped", reason: readiness.message };
  }

  const brief = build.brief as { fixContext?: unknown } | null;
  const gate = await checkBuildPhaseGate({
    buildId,
    from: "review",
    to: "ship",
    evidence: {
      kind: build.kind,
      processSize: ((build.plan as Record<string, unknown> | null)?.processSize as string | undefined) ?? "medium",
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
      uxTestResults: build.uxTestResults,
      uxVerificationStatus: build.uxVerificationStatus,
    },
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
  try {
    const { completeBuildPhaseRun, startBuildPhaseRun } = await import(
      "@/lib/build/build-phase-run"
    );
    void completeBuildPhaseRun(buildId, "review");
    void startBuildPhaseRun(buildId, "ship", {
      ...(executionProfileRef ? { executionProfileRef } : {}),
    }).catch(() => {});
  } catch {
    /* phase evidence is best-effort and never replaces the lifecycle row */
  }
  await log(
    "Advanced review→ship (diff already extracted). Push to GitHub remains an owner gate.",
  );

  // EP-QUALITY-RIGHTSIZING P3 (BI-CFEB2B22): the diff now exists, so derive the
  // ACTUAL blast-radius sensitivity and compare it to the pre-codegen keyword
  // sizing. When the real reach EXCEEDS the keyword guess — the "keyword miss"
  // (e.g. a styling tweak that edited a shared module imported by auth/billing) —
  // surface it at this human ship gate so the change gets the scrutiny its real
  // blast radius warrants. Non-blocking + fail-open; gated on the same flag.
  try {
    const { isQualityFirstRightsizingEnabled } = await import("./build-studio-config");
    if (await isQualityFirstRightsizingEnabled()) {
      const { deriveBlastRadiusSensitivity } = await import("./change-impact");
      const { deriveDeliverableSensitivity, DELIVERABLE_SENSITIVITIES } = await import(
        "@/lib/explore/build-process-matrix"
      );
      const blast = await deriveBlastRadiusSensitivity((build.diffPatch as string | null) ?? "");
      const briefObj = build.brief as
        | { title?: string; description?: string; acceptanceCriteria?: unknown }
        | null;
      const sensitivityText = [
        briefObj?.title,
        briefObj?.description,
        ...(Array.isArray(briefObj?.acceptanceCriteria) ? briefObj.acceptanceCriteria : []),
      ]
        .filter(Boolean)
        .join(" ");
      const riskPosture = await prisma.businessContext
        .findFirst({ select: { riskPosture: true } })
        .then((r) => r?.riskPosture ?? null)
        .catch(() => null);
      const keyword = deriveDeliverableSensitivity(
        { text: sensitivityText, workType: build.kind },
        riskPosture,
      );
      if (DELIVERABLE_SENSITIVITIES.indexOf(blast) > DELIVERABLE_SENSITIVITIES.indexOf(keyword)) {
        await log(
          `⚠ Blast-radius check: this change actually reaches ${blast}-sensitivity scope — above the "${keyword}" it was sized for. Recommend extra review before pushing to GitHub.`,
        );
      }
    }
  } catch (err) {
    console.warn(
      "[ship-on-review-approval] blast-radius sensitivity check failed (non-blocking):",
      err instanceof Error ? err.message : err,
    );
  }

  // Best-effort: live UI update.
  try {
    if (build.threadId) {
      const { agentEventBus } = await import("@/lib/agent-event-bus");
      agentEventBus.emit(build.threadId, { type: "phase:change", buildId, phase: "ship" });
    }
  } catch {
    /* best-effort */
  }

  // Resolve the ship forks toward completion. When autonomous completion is
  // enabled (operator opt-in), set up the forks — push the community PR and
  // register the product/promotion — so the build completes once its merged
  // code is live via the platform self-upgrade. Otherwise just attempt
  // completion in case the forks are already resolved (operator-driven ship).
  if (isAutoCompleteEnabled()) {
    await autoResolveShipForks(buildId, log);
  } else {
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
  }

  return { kind: "dispatched-success", durationMs: Date.now() - t0 };
}

/**
 * Autonomous build completion — operator opt-in, DEFAULT OFF.
 *
 * When enabled, a verified build that reaches `ship` auto-resolves its ship
 * forks (pushes the community PR + registers the product/promotion) and
 * completes once its merged code is live via the platform self-upgrade (the
 * deploy you already run — NOT the per-build promoter). Off by default so an
 * operator enables it deliberately and watches the first autonomous delivery
 * before leaving it on. This is the "auto-push PR + complete-via-self-upgrade"
 * path chosen by the operator (2026-06-20).
 *
 *   DPF_AUTO_COMPLETE_VERIFIED_BUILDS = "1" | "true" | "on"
 */
export function isAutoCompleteEnabled(): boolean {
  const v = (process.env.DPF_AUTO_COMPLETE_VERIFIED_BUILDS ?? "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "on";
}

/**
 * Set up both ship forks for a build at `ship` so it can complete autonomously:
 *   - upstream (community PR) via `contribute_to_hive` (idempotent: skipped if a
 *     PR already exists; a no-op/"install is private" result is fine — the
 *     upstream fork auto-skips in that mode);
 *   - promote (product + promotion) via `register_digital_product_from_build`
 *     (idempotent: skipped if a ProductVersion already exists).
 * Then attempts completion. reconcileBuildCompletion gates on the forks being
 * terminal AND the merged SHA being live (`isFeatureBuildDeployed`), so this is
 * a no-op until the PR merges and the next self-upgrade deploys it — the
 * periodic ship reconciler (instrumentation.ts) finishes it then. Never throws;
 * any unresolved fork simply parks the build at `ship` for an operator.
 */
export async function autoResolveShipForks(
  buildId: string,
  log: (summary: string) => Promise<void>,
): Promise<void> {
  const build = await prisma.featureBuild.findUnique({
    where: { buildId },
    select: { id: true, phase: true, title: true, portfolioId: true, createdById: true },
  });
  if (!build || build.phase !== "ship") return;

  // Resolve the actor: the build's creator, or the install owner for ownerless
  // (system-created) builds — mirrors autoDispatchShipForCompletedVerification.
  let actorUserId = build.createdById;
  if (!actorUserId) {
    try {
      const { resolveScheduledOwnerUserId } = await import("@/lib/queue/scheduled-owner");
      actorUserId = await resolveScheduledOwnerUserId();
    } catch {
      /* fall through to the null guard */
    }
  }
  if (!actorUserId) {
    await log("auto-complete: no resolvable actor — parked at ship for operator");
    return;
  }

  const { executeTool } = await import("@/lib/mcp-tools");

  // ── Upstream fork (community PR) — idempotent: skip if a PR already exists.
  const existingPack = await prisma.featurePack.findFirst({
    where: { buildId: build.id, prUrl: { not: null } },
    select: { id: true },
  });
  if (!existingPack) {
    try {
      const pr = await executeTool("contribute_to_hive", { buildId }, actorUserId);
      await log(
        `auto-complete PR: ${pr.success ? "pushed upstream" : `not pushed — ${String(pr.message ?? pr.error ?? "").slice(0, 140)}`}`,
      );
    } catch (err) {
      await log(`auto-complete PR failed: ${String(err instanceof Error ? err.message : err).slice(0, 140)}`);
    }
  }

  // ── Promote fork — register product + promotion. Idempotent: skip if a
  //    ProductVersion already exists for this build.
  const existingPv = await prisma.productVersion.findFirst({
    where: { featureBuildId: build.id },
    select: { id: true },
  });
  if (!existingPv) {
    let portfolioSlug = "";
    if (build.portfolioId) {
      const pf = await prisma.portfolio.findUnique({
        where: { id: build.portfolioId },
        select: { slug: true },
      });
      portfolioSlug = pf?.slug ?? "";
    }
    try {
      const reg = await executeTool(
        "register_digital_product_from_build",
        { buildId, name: build.title, portfolioSlug },
        actorUserId,
      );
      await log(
        `auto-complete promote: ${reg.success ? "product + promotion registered" : `failed — ${String(reg.message ?? reg.error ?? "").slice(0, 140)}`}`,
      );
    } catch (err) {
      await log(`auto-complete promote failed: ${String(err instanceof Error ? err.message : err).slice(0, 140)}`);
    }
  }

  // ── Attempt completion. For a fully-local (private/fork_only) build the local
  //    promotion IS the delivery, so completeLocalDeliveryBuild finishes it now
  //    (no upstream PR / remote deploy will ever come). Otherwise this is a
  //    no-op until the PR merges AND the self-upgrade carries the merge SHA
  //    live; the periodic ship reconciler finishes that case.
  try {
    const { reconcileBuildCompletion, completeLocalDeliveryBuild } = await import("@/lib/build-flow-state");
    if (await reconcileBuildCompletion(buildId)) {
      await log("auto-complete: build COMPLETE (merged code live).");
    } else if (await completeLocalDeliveryBuild(buildId)) {
      await log("auto-complete: build COMPLETE (delivered locally — fully-local install).");
    } else {
      await log("auto-complete: forks set up; completes after PR merge + self-upgrade.");
    }
  } catch (err) {
    await log(`auto-complete reconcile failed: ${String(err instanceof Error ? err.message : err).slice(0, 140)}`);
  }
}
