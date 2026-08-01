// Build recovery instrumentation helpers. Imported only by the Node instrumentation entrypoint.

/**
 * FIX 1 (spec §3.1 engine-first / FB-78E967D4) — Contradictory-checkpoint
 * auto-recovery. A portal restart or an older buggy pipeline pass can strand a
 * build's `buildExecState` in one of three self-contradictory shapes that NO
 * existing recovery path accepts, so "Reset Build" was the only escape:
 *   • missing-step       — restart killed the pipeline before step 1
 *   • error-without-fail — a non-`failed` step carrying an error/failedAt
 *   • complete-no-verify — step=complete but verificationOut never populated
 *
 * This reconciler applies the same classification the UI uses
 * (classifyContradictoryExecState) and the shared recovery plan
 * (planExecStateRecovery) automatically, with no human:
 *   • error-without-fail → coerce to `failed` so `retryBuildExecution`'s
 *     machinery can resume from the failed step (container/port/diagnosis
 *     preserved).
 *   • missing-step / complete-no-verify → clear the checkpoint so the pipeline
 *     restarts clean (its own self-heal re-runs setup idempotently).
 *
 * Idempotent: a healthy or already-`failed` row yields `action: "none"` and is
 * skipped, so this is safe to run on every boot. Non-fatal. Exported for tests.
 */
export async function recoverContradictoryBuildExecStatesOnBoot(
  logger: Pick<Console, "log" | "error"> = console,
): Promise<{ recovered: number; cleared: number; failedCoerced: number } | null> {
  if (process.env.NEXT_RUNTIME && process.env.NEXT_RUNTIME !== "nodejs") return null;
  try {
    const { prisma, Prisma } = await import("@dpf/db");
    const { planExecStateRecovery } = await import("@/lib/integrate/build-exec-types");
    type ExecStateLike = import("@/lib/integrate/build-exec-types").ExecStateLike;
    // Scan only rows still in the build phase; filter the null/contradictory
    // discrimination in JS to avoid Prisma JSON-null filter subtleties.
    const candidates = await prisma.featureBuild.findMany({
      where: { phase: "build" },
      select: { buildId: true, buildExecState: true, verificationOut: true },
    });
    let cleared = 0;
    let failedCoerced = 0;
    for (const build of candidates) {
      const plan = planExecStateRecovery(
        build.buildExecState as ExecStateLike | null,
        build.verificationOut,
      );
      if (plan.action === "none") continue;
      if (plan.action === "clear") {
        await prisma.featureBuild.update({
          where: { buildId: build.buildId },
          // DbNull (SQL NULL) matches resetBuildExecution's clear semantics, so
          // the UI reads `buildExecState == null` (not contradictory) afterwards.
          data: { buildExecState: Prisma.DbNull },
        });
        cleared++;
        logger.log(
          `[build-exec-recover] ${build.buildId} -> cleared checkpoint (reason=${plan.reason}); pipeline will restart clean`,
        );
      } else {
        await prisma.featureBuild.update({
          where: { buildId: build.buildId },
          data: {
            buildExecState: plan.state as unknown as import("@dpf/db").Prisma.InputJsonValue,
          },
        });
        failedCoerced++;
        logger.log(
          `[build-exec-recover] ${build.buildId} -> coerced to failed (reason=${plan.reason}); Retry can now resume from failedAt=${plan.state.failedAt ?? "?"}`,
        );
      }
      await prisma.buildActivity
        .create({
          data: {
            buildId: build.buildId,
            tool: "recoverContradictoryBuildExecStatesOnBoot",
            summary:
              plan.action === "clear"
                ? `Auto-recovered contradictory checkpoint on boot (reason=${plan.reason}): cleared for clean restart`
                : `Auto-recovered contradictory checkpoint on boot (reason=${plan.reason}): coerced to failed for retry`,
          },
        })
        .catch(() => {});
    }
    const recovered = cleared + failedCoerced;
    if (recovered > 0) {
      logger.log(
        `[build-exec-recover] recovered ${recovered} contradictory checkpoint(s): ${cleared} cleared, ${failedCoerced} coerced to failed`,
      );
    }
    return { recovered, cleared, failedCoerced };
  } catch (err) {
    logger.error("[build-exec-recover] failed (non-fatal):", err);
    return null;
  }
}

/**
 * Advance a build stranded at the build→review boundary, mirroring the
 * orchestrator's on-completion auto-advance (build-orchestrator.ts ~1518).
 *
 * Recomputes the SCOPED verification for the build (out-of-scope failures
 * elsewhere in the repo are nulled and treated as a pass; an IN-scope failure
 * stays blocking so a genuinely-broken build is NOT force-advanced), runs the
 * `build->review` phase gate, and — only if the gate allows AND the row is
 * still `phase=build` — flips it to `review` and queues review verification.
 *
 * Returns `true` iff it advanced. Idempotent: a build already past `build`, or
 * one whose in-scope verification fails the gate, is a no-op. Non-throwing for
 * the scoped-verification step (a scope-resolution failure falls back to the
 * raw verificationOut, exactly like the orchestrator). Exported for tests.
 */
export async function advanceStrandedBuildToReview(buildId: string): Promise<boolean> {
  if (process.env.NEXT_RUNTIME && process.env.NEXT_RUNTIME !== "nodejs") return false;
  const { prisma } = await import("@dpf/db");
  const { checkPhaseGate, canTransitionPhase } = await import("@/lib/feature-build-types");

  const build = await prisma.featureBuild.findUnique({ where: { buildId } });
  if (!build || build.phase !== "build" || !canTransitionPhase("build", "review")) {
    return false;
  }

  // Scope the verification to THIS build's changed files before gating — a
  // pre-existing failure ELSEWHERE in the repo must not block the advance.
  // getScopedVerificationForBuild nulls out-of-scope failures; treat null
  // (out-of-scope only) as a pass, keep an in-scope failure (false) blocking.
  let verificationForGate: unknown = build.verificationOut;
  try {
    const { getScopedVerificationForBuild } = await import("@/lib/build/scoped-verification");
    const scoped = await getScopedVerificationForBuild(buildId);
    if (scoped) {
      verificationForGate = {
        ...((build.verificationOut ?? {}) as Record<string, unknown>),
        typecheckPassed: scoped.buildScoped.typecheckPassed ?? true,
        testsFailed: scoped.buildScoped.testsFailed ?? 0,
      };
    }
  } catch {
    // Fall back to the raw verificationOut, exactly like the orchestrator.
  }

  const gate = checkPhaseGate("build", "review", {
    verificationOut: verificationForGate as typeof build.verificationOut,
  });
  if (!gate.allowed) return false;

  // Guard the flip on the row still being `build` so two concurrent reconcilers
  // (or a live advance racing this one) never double-advance.
  const flipped = await prisma.featureBuild.updateMany({
    where: { buildId, phase: "build" },
    data: { phase: "review" },
  });
  if (flipped.count === 0) return false;

  const { queueBuildReviewVerification } = await import("@/lib/build-review-verification-trigger");
  await queueBuildReviewVerification(buildId);
  return true;
}

/**
 * Periodic ship→complete reconciler for the autonomous-completion path
 * (operator opt-in via DPF_AUTO_COMPLETE_VERIFIED_BUILDS, default OFF).
 *
 * A verified build that reached `ship` — with its forks set up by
 * `autoResolveShipForks` (community PR pushed + product/promotion registered) —
 * completes once its merged code is LIVE via the platform self-upgrade (the
 * deploy the operator already runs; NOT the per-build promoter). This loop
 * detects that: for each `ship`-phase build whose merged SHA is now in the
 * deployed runtime (`isFeatureBuildDeployed`), it marks the build's still-open
 * promotion(s) `deployed` — the self-upgrade WAS the deploy — so the promote
 * fork becomes terminal, then runs `reconcileBuildCompletion` to advance
 * ship→complete.
 *
 * No-op (and cheap) when the flag is off or no ship build is deployed yet.
 * Idempotent + non-throwing. Exported for tests.
 */
export async function reconcileDeployedShipBuilds(
  logger: Pick<Console, "log" | "error"> = console,
): Promise<{ completed: number } | null> {
  if (process.env.NEXT_RUNTIME && process.env.NEXT_RUNTIME !== "nodejs") return null;
  const { isAutoCompleteEnabled } = await import("@/lib/integrate/ship-on-review-approval");
  if (!isAutoCompleteEnabled()) return null;
  try {
    const { prisma } = await import("@dpf/db");
    const { reconcileBuildCompletion, completeLocalDeliveryBuild } = await import("@/lib/build-flow-state");
    const { isFeatureBuildDeployed } = await import("@/lib/self-upgrade/completion");

    const shipBuilds = await prisma.featureBuild.findMany({
      where: { phase: "ship" },
      select: { id: true, buildId: true },
    });
    const { mayCompleteAutonomousBuild } =
      await import("@/lib/build/autonomous-build-completion-gate");
    let completed = 0;
    for (const build of shipBuilds) {
      try {
        if (!(await isFeatureBuildDeployed(build.buildId))) {
          // A fully-local install treats ProductVersion registration as delivery.
          // Upstream builds no-op here and keep waiting for deployed evidence.
          if (!(await mayCompleteAutonomousBuild({ buildId: build.buildId, logger }))) continue;
          if (await completeLocalDeliveryBuild(build.buildId)) {
            completed++;
            logger.log(
              `[auto-complete] ${build.buildId} completed — delivered locally (fully-local install)`,
            );
          }
          continue;
        }
        if (!(await mayCompleteAutonomousBuild({ buildId: build.buildId, logger }))) continue;
        // Merged code is live via self-upgrade → mark the build's still-open
        // promotion(s) deployed so the promote fork is terminal. The platform
        // self-upgrade IS the deploy here (the per-build promoter is not used).
        const pvs = await prisma.productVersion.findMany({
          where: { featureBuildId: build.id },
          select: { id: true },
        });
        if (pvs.length > 0) {
          await prisma.changePromotion.updateMany({
            where: {
              productVersionId: { in: pvs.map((p) => p.id) },
              status: { in: ["pending", "approved", "scheduled", "awaiting_operator"] },
            },
            data: {
              status: "deployed",
              deployedAt: new Date(),
              rationale: "Deployed via platform self-upgrade (autonomous build completion)",
            },
          });
        }
        if (await reconcileBuildCompletion(build.buildId)) {
          completed++;
          logger.log(
            `[auto-complete] ${build.buildId} completed — merged code live via self-upgrade`,
          );
        }
      } catch (err) {
        logger.error(
          "[auto-complete] ship reconcile failed for %s: %s",
          JSON.stringify(build.buildId),
          err instanceof Error ? JSON.stringify(err.message) : JSON.stringify(String(err)),
        );
      }
    }
    return { completed };
  } catch (err) {
    logger.error(
      "[auto-complete] reconcileDeployedShipBuilds failed: %s",
      err instanceof Error ? JSON.stringify(err.message) : JSON.stringify(String(err)),
    );
    return null;
  }
}

/**
 * FIX 2 (spec §3.1 engine-first) — Restart-resume for stranded build rows. The
 * pipeline is dispatched fire-and-forget (`autoExecuteBuild(...).catch(...)`),
 * so a portal recycle silently kills it mid-flight, leaving a row in the `build`
 * phase at a non-terminal step that nothing ever picks up again — the build just
 * stops.
 *
 * This reconciler finds those rows and re-dispatches them. `autoExecuteBuild`
 * reads the persisted `buildExecState` and `runBuildPipeline` resumes from
 * `getResumeStep`, re-running the interrupted step idempotently — no work is
 * lost and no duplicate sandbox is created.
 *
 * Liveness guard: only rows whose `updatedAt` is older than `staleAfterMs`
 * (default 5 min — comfortably longer than the heartbeat-ticker cadence that
 * touches `buildExecState` during a legitimately slow step) are resumed, so a
 * genuinely in-flight build on a still-running portal is never double-dispatched.
 * Contradictory shapes are left to recoverContradictoryBuildExecStatesOnBoot
 * (which runs first); this only resumes internally-consistent, mid-step rows.
 *
 * Idempotent and safe to run every boot. Non-fatal. Exported for tests.
 */
export async function resumeStrandedBuildsOnBoot(
  opts: {
    staleAfterMs?: number;
    dispatch?: (buildId: string) => void;
    /**
     * Injectable pre-build-phase resumer (BI-9257CF19). Fire-and-forget;
     * defaults to the canonical {@link resumePreBuildPhase} importer. Injected
     * in tests so the boot reconcile can be asserted without running the real
     * generator/reviewer pipeline.
     */
    resumePreBuild?: (args: { buildId: string; phase: string; userId: string }) => void;
    /**
     * Injectable build->review transition advancer (this fix). Given a build
     * stranded at the build->review boundary (phase=`build`, step=`complete`,
     * verification populated), recomputes the SCOPED verification + the
     * `build->review` phase gate and, if allowed, advances the row to `review`
     * (the same advance the orchestrator does on normal completion). Returns
     * whether it advanced. Defaults to {@link advanceStrandedBuildToReview};
     * injected in tests so the boot reconcile can be asserted without the real
     * sandbox / scoped-verification chain.
     */
    advanceToReview?: (buildId: string) => Promise<boolean>;
    /**
     * Age-out cap (BI-A009313E). A build created longer ago than this while
     * STILL in a resumable pre-build phase (ideate/plan/review) is aged out to
     * `abandoned` instead of resumed again — capping the perpetual resume loop
     * that a self-upgrade swap re-triggers every time. Keyed on createdAt so the
     * cap is immune to the resume churn re-heartbeating the row. Defaults to
     * {@link STRANDED_ABANDON_MS} (7 days).
     */
    abandonAfterMs?: number;
    /**
     * Injectable age-out reaper (BI-A009313E). Given a stranded pre-build build
     * past the cap, transition it to `abandoned` and return whether it did.
     * Defaults to {@link abandonStrandedPreBuild}; injected in tests so the boot
     * reconcile can be asserted without a real DB write.
     */
    abandonStale?: (args: { buildId: string; phase: string; ageMs: number }) => Promise<boolean>;
  } = {},
  logger: Pick<Console, "log" | "error"> = console,
): Promise<{ resumed: number; flagged: number; advanced: number; abandoned: number } | null> {
  if (process.env.NEXT_RUNTIME && process.env.NEXT_RUNTIME !== "nodejs") return null;
  const staleAfterMs = opts.staleAfterMs ?? 5 * 60 * 1000;
  try {
    const { prisma } = await import("@dpf/db");
    const { classifyContradictoryExecState } = await import(
      "@/lib/integrate/build-exec-types"
    );
    type ExecStateLike = import("@/lib/integrate/build-exec-types").ExecStateLike;
    // Age-out cap primitives (BI-A009313E). Lazy-imported to keep the boot module
    // graph small, matching this file's convention.
    const { isStrandedPreBuildAbandonable, STRANDED_ABANDON_MS } = await import(
      "@/lib/integrate/resume-pre-build-phase"
    );
    const now = new Date();
    const cutoff = new Date(now.getTime() - staleAfterMs);
    const abandonAfterMs = opts.abandonAfterMs ?? STRANDED_ABANDON_MS;
    // BI-17377D05: cover ALL non-terminal pre-ship phases, not just `build`.
    // Only the `build` phase has a resumable step-machine (buildExecState) that
    // autoExecuteBuild can re-dispatch; ideate/plan/review are dispatch-driven
    // with no resume, so a swap (or a dead dispatch) used to strand them
    // SILENTLY. We still auto-resume `build`; for the pre-build phases we surface
    // the strand as recoverable so it stops being a silent orphan.
    const candidates = await prisma.featureBuild.findMany({
      where: {
        phase: { in: ["ideate", "plan", "build", "review"] },
        updatedAt: { lt: cutoff },
      },
      select: {
        buildId: true,
        phase: true,
        buildExecState: true,
        verificationOut: true,
        createdById: true,
        // createdAt + parentEpicId feed the age-out cap (BI-A009313E).
        createdAt: true,
        parentEpicId: true,
      },
    });

    // Default pre-build resumer (BI-9257CF19): lazy-imports the canonical
    // generator/reviewer re-fire and logs the outcome as a BuildActivity row.
    // Fire-and-forget so one slow re-review never blocks the boot reconcile.
    const resumePreBuild =
      opts.resumePreBuild ??
      ((args: { buildId: string; phase: string; userId: string }) => {
        void (async () => {
          const { resumePreBuildPhase } = await import("@/lib/integrate/resume-pre-build-phase");
          const outcome = await resumePreBuildPhase(args);
          await prisma.buildActivity
            .create({
              data: {
                buildId: args.buildId,
                tool: "resumeStrandedBuildsOnBoot",
                summary: `Pre-build resume (${args.phase}): ${outcome.kind}${
                  "via" in outcome ? ` via ${outcome.via} — ${outcome.detail}` : ""
                }${"reason" in outcome ? ` — ${outcome.reason}` : ""}${
                  "error" in outcome ? ` — ${outcome.error}` : ""
                }`,
              },
            })
            .catch(() => {});
        })().catch((err) =>
          logger.error(
            "[build-resume] pre-build resume failed for %s: %s",
            JSON.stringify(args.buildId),
            err instanceof Error ? JSON.stringify(err.message) : JSON.stringify(String(err)),
          ),
        );
      });

    // Default dispatcher lazy-imports the system executor to avoid pulling the
    // server-action module (and its auth wrappers) into the module graph until
    // a resume is actually needed.
    const dispatch =
      opts.dispatch ??
      ((buildId: string) => {
        void (async () => {
          const { autoExecuteBuild } = await import("@/lib/actions/build");
          await autoExecuteBuild(buildId);
        })().catch((err) =>
          logger.error(
            "[build-resume] re-dispatch failed for %s: %s",
            JSON.stringify(buildId),
            err instanceof Error ? JSON.stringify(err.message) : JSON.stringify(String(err)),
          ),
        );
      });

    // Default build->review advancer: the standalone helper that mirrors the
    // orchestrator's on-completion advance (scoped verification + phase gate).
    const advanceToReview = opts.advanceToReview ?? advanceStrandedBuildToReview;

    // Default age-out reaper (BI-A009313E): lazy-imports the canonical abandon
    // helper so a build stranded in a pre-build phase past the cap is retired to
    // `abandoned` rather than resumed forever.
    const abandonStale =
      opts.abandonStale ??
      (async (args: { buildId: string; phase: string; ageMs: number }) => {
        const { abandonStrandedPreBuild } = await import(
          "@/lib/integrate/resume-pre-build-phase"
        );
        return abandonStrandedPreBuild(args);
      });

    let resumed = 0;
    let flagged = 0;
    let advanced = 0;
    let abandoned = 0;
    for (const build of candidates) {
      // ── Pre-build phases (ideate/plan/review): no step-machine, but each
      // phase has a canonical generator/reviewer we can re-fire. BI-9257CF19:
      // auto-resume instead of merely flagging for operator rescue, so an
      // in-flight build survives a self-upgrade swap (the resume-after half of
      // the quiescence contract). Re-firing is safe here because the candidate
      // query already excludes anything updated within the staleness cutoff,
      // and each underlying dispatcher carries its own idempotency guard. Fire-
      // and-forget so one slow re-review never blocks the boot reconcile loop.
      if (build.phase !== "build") {
        // ── Age-out cap (BI-A009313E). A build created past the abandon
        // threshold while STILL in a pre-build phase has failed to progress for
        // a week — re-resuming it only re-churns the loop that a self-upgrade
        // swap re-triggers every time (the acute flood: 63 dead ideate strands
        // re-resumed on every swap). Retire it to `abandoned` so it leaves the
        // candidate set for good; quiescence's reconcileTerminalBuildPhaseRuns
        // then closes its open BuildPhaseRun. Keyed on createdAt, so this is
        // immune to the resume churn re-heartbeating the row (the exact reason
        // the quiescence dead-phase reaper can't clear these). Re-promote the
        // backlog item to retry — abandonment is reversible.
        if (
          isStrandedPreBuildAbandonable({
            phase: build.phase,
            createdAt: build.createdAt,
            parentEpicId: build.parentEpicId,
            now,
            thresholdMs: abandonAfterMs,
          })
        ) {
          const ageMs = now.getTime() - build.createdAt.getTime();
          const didAbandon = await abandonStale({
            buildId: build.buildId,
            phase: build.phase,
            ageMs,
          });
          if (didAbandon) {
            abandoned++;
            logger.log(
              `[build-resume] ${build.buildId} stranded in ${build.phase} for >${Math.round(
                ageMs / 86_400_000,
              )}d — aged out to abandoned instead of resuming (BI-A009313E)`,
            );
            continue;
          }
          // Abandon declined (raced to alive/terminal); fall through to resume.
        }

        logger.log(
          `[build-resume] ${build.buildId} stranded in ${build.phase} phase after restart/swap — auto-resuming (BI-9257CF19)`,
        );
        await prisma.buildActivity
          .create({
            data: {
              buildId: build.buildId,
              tool: "resumeStrandedBuildsOnBoot",
              summary: `Stranded in ${build.phase} phase after a restart/swap — auto-resuming the canonical ${build.phase} generator/reviewer (BI-9257CF19).`,
            },
          })
          .catch(() => {});
        resumePreBuild({ buildId: build.buildId, phase: build.phase, userId: build.createdById });
        flagged++;
        continue;
      }

      // ── Build phase: proven step-machine resume (unchanged behavior). ──
      const state = build.buildExecState as ExecStateLike | null;
      // Skip contradictory shapes — the contradictory-recovery reconciler owns
      // those. (This also excludes the `complete-no-verify` relic, so the
      // build->review branch below only sees a genuinely verified `complete`.)
      if (classifyContradictoryExecState(state, build.verificationOut) !== null) continue;
      const step = state?.step;

      // ── Build->review transition strand (this fix). A build whose tasks all
      // ran and whose verification populated (step=`complete`, non-contradictory)
      // but whose phase is still `build` was interrupted at the auto-advance
      // boundary: a self-upgrade swap (or an advance that fired before a gate fix
      // deployed) killed the orchestrator AFTER it persisted `complete` but
      // BEFORE it flipped phase->review. Nothing re-fires the advance, so the
      // build sits in `build` forever, quiet. Re-run the SAME advance the
      // orchestrator does on normal completion: recompute the SCOPED verification
      // and the `build->review` gate, and advance only if it passes. A
      // genuinely-broken build (in-scope failure) leaves the gate disallowed and
      // is left stranded — we never force-advance it. Observed live: FB-69231490
      // (3/3 tasks DONE, scoped typecheckPassed=true testsFailed=0, never
      // advanced for 35+ min).
      if (step === "complete") {
        try {
          const didAdvance = await advanceToReview(build.buildId);
          if (didAdvance) {
            logger.log(
              `[build-resume] ${build.buildId} stranded at build→review transition — advancing (gate passed)`,
            );
            await prisma.buildActivity
              .create({
                data: {
                  buildId: build.buildId,
                  tool: "resumeStrandedBuildsOnBoot",
                  summary:
                    "Stranded at the build→review transition after a restart/swap (tasks complete, scoped gate passes) — advancing to review.",
                },
              })
              .catch(() => {});
            advanced++;
          }
        } catch (advErr) {
          logger.error(
            "[build-resume] build→review advance failed for %s: %s",
            JSON.stringify(build.buildId),
            advErr instanceof Error ? JSON.stringify(advErr.message) : JSON.stringify(String(advErr)),
          );
        }
        continue;
      }

      // Terminal `failed` step — owned by the contradictory-recovery reconciler;
      // leave as-is.
      if (step === "failed") continue;

      // Null/absent exec-state in `build` phase (BI-B036209D): no working
      // step-machine (recovery cleared it "for clean restart", or a 0-task
      // orchestration then null). Previously skipped here AND uncovered by the
      // pre-build age-out above → silent forever-orphan blocking its dependents.
      // Re-dispatch to honor the clean-restart intent; age out past the cap so a
      // never-dispatchable build is reaped, not churned. `build`-phase strands are
      // NOT epic-coordinated, so the cap applies regardless of parentEpicId.
      if (step == null) {
        const ageMs = now.getTime() - build.createdAt.getTime();
        if (ageMs > abandonAfterMs) {
          const didAbandon = await abandonStale({
            buildId: build.buildId,
            phase: build.phase,
            ageMs,
          });
          if (didAbandon) {
            abandoned++;
            logger.log(
              `[build-resume] ${build.buildId} stranded in build phase with no exec-state for >${Math.round(
                ageMs / 86_400_000,
              )}d — aged out to abandoned instead of re-dispatching forever (BI-B036209D)`,
            );
            continue;
          }
          // Abandon declined (raced to alive/terminal) — fall through to re-dispatch.
        }
        logger.log(
          `[build-resume] ${build.buildId} stranded in build phase with no exec-state — re-dispatching for a clean restart (BI-B036209D)`,
        );
        await prisma.buildActivity
          .create({
            data: {
              buildId: build.buildId,
              tool: "resumeStrandedBuildsOnBoot",
              summary:
                "Stranded in build phase with no exec-state (cleared for restart / 0-task orchestration) — re-dispatching for a clean restart (BI-B036209D).",
            },
          })
          .catch(() => {});
        dispatch(build.buildId);
        resumed++;
        continue;
      }

      logger.log(
        `[build-resume] ${build.buildId} stranded at step=${step} (no progress since updatedAt) — re-dispatching pipeline`,
      );
      await prisma.buildActivity
        .create({
          data: {
            buildId: build.buildId,
            tool: "resumeStrandedBuildsOnBoot",
            summary: `Re-dispatched stranded build on boot (step=${step}); pipeline resumes from getResumeStep`,
          },
        })
        .catch(() => {});
      dispatch(build.buildId);
      resumed++;
    }
    if (resumed > 0) {
      logger.log(`[build-resume] re-dispatched ${resumed} stranded build(s)`);
    }
    if (flagged > 0) {
      logger.log(`[build-resume] auto-resumed ${flagged} pre-build-phase strand(s) (ideate/plan/review)`);
    }
    if (advanced > 0) {
      logger.log(`[build-resume] advanced ${advanced} build→review transition strand(s)`);
    }
    if (abandoned > 0) {
      logger.log(
        `[build-resume] aged out ${abandoned} stranded pre-build strand(s) to abandoned (created > ${Math.round(
          abandonAfterMs / 86_400_000,
        )}d ago, no progress) (BI-A009313E)`,
      );
    }
    return { resumed, flagged, advanced, abandoned };
  } catch (err) {
    logger.error("[build-resume] failed (non-fatal):", err);
    return null;
  }
}
