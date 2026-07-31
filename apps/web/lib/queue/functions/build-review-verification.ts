/**
 * Inngest: build-review-verification
 *
 * Fires when a build transitions into the `review` phase (see
 * `advanceBuildPhase` in apps/web/lib/actions/build.ts). Drives the
 * coworker-driven UX verification pipeline end to end:
 *
 *   1. Load build + brief
 *   2. If there are no acceptance criteria, OR the build changed no UI surface
 *      a browser can drive (pure library/backend/doc change — see
 *      `shouldRunBrowserUxVerification`), mark `uxVerificationStatus = "skipped"`
 *      and auto-dispatch ship. UX verification is advisory (non-blocking) per
 *      the ratified gate policy, so a build with nothing browser-verifiable must
 *      advance to ship rather than strand in review on a vacuous 0/1 failure.
 *   3. Otherwise call browser-use with `evidence_dir: build_<buildId>`
 *      so screenshots land on the shared /evidence volume
 *   4. Persist UxTestStep[] to `FeatureBuild.uxTestResults` AND set
 *      `uxVerificationStatus` to "complete" or "failed"
 *   5. Emit verification:* progress events so the coworker panel and
 *      ReviewPanel both update live
 *
 * Replaces the old `autoA11yAudit` fire-and-forget. Failed steps block
 * review -> ship via the existing `checkPhaseGate` reading
 * `uxTestResults + uxVerificationStatus` (chunk 6 of the plan).
 */

import { inngest } from "../inngest-client";
import { buildPipelineConcurrency } from "../admission";
import { shouldRunBrowserUxVerification } from "@/lib/build/ui-surface";

export const buildReviewVerification = inngest.createFunction(
  {
    id: "build/review-verification",
    retries: 1,
    concurrency: buildPipelineConcurrency({ limit: 2 }),
    triggers: [{ event: "build/review.verify" }],
  },
  async ({ event, step }) => {
    const { buildId } = event.data as { buildId: string };

    const build = await step.run("load-build", async () => {
      const { prisma } = await import("@dpf/db");
      return prisma.featureBuild.findUnique({
        where: { buildId },
        select: {
          id: true,
          buildId: true,
          title: true,
          createdById: true,
          sandboxId: true,
          sandboxPort: true,
          brief: true,
          threadId: true,
          kind: true,
          diffPatch: true,
          verificationOut: true,
        },
      });
    });

    if (!build || !build.sandboxId || !build.sandboxPort) {
      return { skipped: true, reason: "sandbox or build missing" };
    }

    const { deriveFixUxTestCases } = await import("@/lib/explore/feature-build-types");
    const brief = build.brief as {
      acceptanceCriteria?: string[];
      fixContext?: import("@/lib/explore/feature-build-types").FixContext;
    } | null;
    // For a fix build, `acceptanceCriteria` is often polluted with fixContext
    // prose (the brief reuses the feature shape), which produced nonsense
    // browser-use navigations like `https://fixContext.reproSteps`. Derive the
    // UX assertion from the structured fix diagnosis instead — verify the
    // reported defect no longer reproduces on its route. (BI-AC5CFDB0)
    const testCases =
      build.kind === "fix"
        ? deriveFixUxTestCases(brief?.fixContext)
        : brief?.acceptanceCriteria ?? [];

    // Resolve the build's changed files so we can tell whether there is a
    // RENDERED UI surface for browser-use to drive. A pure library/backend/doc
    // build (no .tsx/.jsx) has only code-level acceptance criteria a browser
    // cannot assert — running browser-use on it returns a vacuous 0/1 failure
    // that, combined with auto-ship-only-on-"complete", stranded the build in
    // review forever. Prefer the captured diff; fall back to the plan's declared
    // files when the diff projection is not yet populated at review time.
    const changedFiles = await step.run("resolve-changed-files", async () => {
      const { getSandboxStateForBuild } = await import("@/lib/build/sandbox-state");
      const sandboxState = await getSandboxStateForBuild(buildId);
      const diffFiles = sandboxState?.sourceDiffstat.map((entry) => entry.path) ?? [];
      if (diffFiles.length > 0) return diffFiles;
      return sandboxState?.expectedPlanFiles.map((file) => file.path) ?? [];
    });
    const runBrowserUse = shouldRunBrowserUxVerification({
      testCaseCount: testCases.length,
      changedFiles,
    });

    // Phase 3 of the shared Change Reviewer control: task-level reviews remain
    // intact, then one surface-neutral review evaluates the assembled committed
    // change before UX verification or promotion. Shadow mode is the rollback
    // default until outcome telemetry calibrates deterministic enforcement.
    const semanticReview = await step.run("semantic-change-review", async () => {
      const { getSandboxStateForBuild } = await import("@/lib/build/sandbox-state");
      const { reviewBuildStudioAssembledChange } = await import(
        "@/lib/change-review/build-studio-semantic-review"
      );
      return reviewBuildStudioAssembledChange({
        build,
        sandboxState: await getSandboxStateForBuild(buildId),
      });
    });
    if (semanticReview.kind === "unavailable" && !semanticReview.mayContinue) {
      return { status: "semantic-review-unavailable", reason: semanticReview.reason };
    }
    if (semanticReview.kind === "reviewed" && !semanticReview.outcome.mayPublish) {
      return {
        status: "semantic-review-blocked",
        decision: semanticReview.outcome.receipt.result.decision,
        nextAction: semanticReview.outcome.nextAction,
      };
    }

    await step.run("start-verification", async () => {
      const { prisma } = await import("@dpf/db");
      await prisma.featureBuild.update({
        where: { buildId },
        data: { uxVerificationStatus: "running" },
      });
      if (build.threadId) {
        const { agentEventBus } = await import("@/lib/agent-event-bus");
        agentEventBus.emit(build.threadId, {
          type: "verification:started",
          buildId,
          testCount: testCases.length,
        });
      }
    });

    if (!runBrowserUse) {
      // Either there are no acceptance criteria to assert, or the build changed
      // no UI surface a browser can drive. Mark UX verification "skipped"
      // (advisory, non-blocking per the ratified gate policy) and proceed to
      // ship rather than stranding in review. The "Ship to GitHub" step remains
      // a human gate downstream — auto-ship only extracts the diff and advances
      // the phase to `ship`.
      const skipReason: "no-acceptance-criteria" | "no-ui-surface" =
        testCases.length === 0 ? "no-acceptance-criteria" : "no-ui-surface";
      await step.run("mark-skipped", async () => {
        const { prisma } = await import("@dpf/db");
        await prisma.featureBuild.update({
          where: { buildId },
          // Clear any stale uxTestResults alongside the status: a build that
          // previously ran browser-use and recorded a failed step would otherwise
          // keep that failed array, defeating hasCompletedUxVerification (which
          // requires every recorded step to pass). A skipped check has no steps.
          data: { uxVerificationStatus: "skipped", uxTestResults: [] },
        });
        await prisma.buildActivity.create({
          data: {
            buildId,
            tool: "review-verification",
            summary:
              skipReason === "no-ui-surface"
                ? `UX verification skipped: build changed no UI surface (${changedFiles.length} file(s), none .tsx/.jsx). Browser checks are not applicable to a library/backend change; advancing to ship.`
                : "UX verification skipped: no acceptance criteria to verify; advancing to ship.",
          },
        }).catch(() => {});
        if (build.threadId) {
          const { agentEventBus } = await import("@/lib/agent-event-bus");
          agentEventBus.emit(build.threadId, {
            type: "verification:complete",
            buildId,
            passed: 0,
            total: 0,
            status: "skipped",
          });
        }
      });
      // Auto-dispatch ship for the skipped (non-blocking) verification — mirrors
      // the "complete" path below so non-UI / no-AC builds are not stranded in
      // review. dispatchShipForVerifiedBuild only extracts the diff and advances
      // to the ship phase; pushing to GitHub stays a human gate.
      await step.run("auto-dispatch-ship", () =>
        autoDispatchShipForCompletedVerification(buildId, "skipped"),
      );
      return { status: "skipped", testCount: testCases.length, reason: skipReason };
    }

    type UxTestStep = {
      step: string;
      passed: boolean;
      screenshotUrl: string | null;
      error: string | null;
    };

    const steps: UxTestStep[] = await step.run("run-tests", async () => {
      const { resolveSandboxUrl } = await import("@/lib/integrate/sandbox/resolve-sandbox-url");
      const { runBrowserUseTests } = await import("@/lib/operate/browser-use-client");
      const sandboxUrl = resolveSandboxUrl(build.sandboxId!, build.sandboxPort!).internal;
      try {
        return await runBrowserUseTests(sandboxUrl, testCases, { buildId });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        // Return one failed step describing the infra failure so the
        // user sees WHY verification didn't run rather than a silent zero-step
        // "failed" state.
        return [
          {
            step: "Launch verification",
            passed: false,
            screenshotUrl: null,
            error: `browser-use unreachable or crashed: ${message.slice(0, 300)}`,
          },
        ];
      }
    });

    // BI-02B98843: advisory adversarial / edge-case pass. Generate negative
    // cases from the acceptance criteria + changed surface and drive them
    // through the same browser-use path, recording the outcome as a
    // BuildActivity row. ADVISORY ONLY — it does NOT touch uxTestResults or
    // uxVerificationStatus, so it cannot flip the (heuristic) happy-path ship
    // gate or disrupt Build Studio while it is being tuned. Failures surface for
    // the operator + the (future) self-iteration fix loop, not hard-gated.
    // Opt out with BUILD_ADVERSARIAL_VERIFICATION=0 (it doubles browser-use time
    // on a UI build, capped at MAX_ADVERSARIAL_CASES cases).
    await step.run("run-adversarial-tests", async () => {
      if (process.env.BUILD_ADVERSARIAL_VERIFICATION === "0") return;
      try {
        const { buildAdversarialCasePrompt, parseAdversarialCases } = await import("@/lib/build/adversarial-cases");
        const { routeAndCall } = await import("@/lib/inference/routed-inference");
        const prompt = buildAdversarialCasePrompt({
          acceptanceCriteria: brief?.acceptanceCriteria ?? [],
          changedFiles,
        });
        const gen = await routeAndCall(
          [{ role: "user", content: "Generate the adversarial cases now." }],
          prompt,
          "internal",
          { taskType: "build-review", budgetClass: "minimize_cost" },
        );
        const cases = parseAdversarialCases(gen.content);
        if (cases.length === 0) return;
        const { resolveSandboxUrl } = await import("@/lib/integrate/sandbox/resolve-sandbox-url");
        const { runBrowserUseTests } = await import("@/lib/operate/browser-use-client");
        const sandboxUrl = resolveSandboxUrl(build.sandboxId!, build.sandboxPort!).internal;
        const advSteps = await runBrowserUseTests(sandboxUrl, cases, { buildId });
        const failed = advSteps.filter((s) => !s.passed);
        const { prisma } = await import("@dpf/db");
        await prisma.buildActivity
          .create({
            data: {
              buildId,
              tool: "adversarial-verification",
              summary:
                `Adversarial pass (advisory): ${advSteps.length - failed.length}/${advSteps.length} handled gracefully` +
                (failed.length > 0
                  ? `. Possible weak spots: ${failed.map((s) => s.step).join(" | ").slice(0, 400)}`
                  : ". No edge-case weaknesses surfaced."),
            },
          })
          .catch(() => {});
      } catch (err) {
        // Best-effort, advisory: never fail verification on the adversarial pass.
        console.warn(
          "[adversarial-verification] skipped: %s",
          err instanceof Error ? JSON.stringify(err.message) : JSON.stringify(String(err)),
        );
      }
    });

    const allPass = steps.length > 0 && steps.every((s) => s.passed);
    const finalStatus: "complete" | "failed" | "skipped" = allPass ? "complete" : "failed";

    await step.run("persist-results", async () => {
      const { prisma } = await import("@dpf/db");
      const { saveBuildArtifactRevisionWithDb } = await import("@/lib/build/build-artifact-provenance");
      await saveBuildArtifactRevisionWithDb(prisma, {
        buildId,
        field: "uxTestResults",
        savedByUserId: "system",
        value: steps,
      });
      await prisma.featureBuild.update({
        where: { buildId },
        data: {
          uxVerificationStatus: finalStatus,
        },
      });
    });

    await step.run("emit-completion", async () => {
      if (build.threadId) {
        const { agentEventBus } = await import("@/lib/agent-event-bus");
        for (let i = 0; i < steps.length; i++) {
          const s = steps[i]!;
          agentEventBus.emit(build.threadId, {
            type: "verification:step",
            buildId,
            stepIndex: i,
            description: s.step,
            passed: s.passed,
          });
        }
        agentEventBus.emit(build.threadId, {
          type: "verification:complete",
          buildId,
          passed: steps.filter((s) => s.passed).length,
          total: steps.length,
          status: finalStatus,
        });
        agentEventBus.emit(build.threadId, {
          type: "evidence:update",
          buildId,
          field: "uxTestResults",
        });
      }
      const { prisma } = await import("@dpf/db");
      const passed = steps.filter((s) => s.passed).length;
      await prisma.buildActivity.create({
        data: {
          buildId,
          tool: "review-verification",
          summary: `UX verification ${finalStatus}: ${passed}/${steps.length} passed.`,
        },
      }).catch(() => {});
    });

    // Auto-dispatch ship when UX verification passes or skips (no test cases).
    // This closes the last manual gate: the operator no longer needs to click
    // "Ship" — the build ships automatically once review verification completes.
    // Failure or infra-error keeps the build in review for manual inspection.
    // finalStatus is "complete" | "failed" here (skipped was handled above).
    // Treat "complete" as the passing signal for auto-ship dispatch.
    if (finalStatus === "complete") {
      await step.run("auto-dispatch-ship", () =>
        autoDispatchShipForCompletedVerification(buildId),
      );
    }

    return { status: finalStatus, passed: steps.filter((s) => s.passed).length, total: steps.length };
  },
);

/**
 * Auto-dispatch the ship phase for a build whose review verification just
 * completed. Extracted from the inngest `step.run` closure so the actor
 * resolution is unit-testable.
 *
 * The resolved actor flows into `dispatchShipForVerifiedBuild` ->
 * `executeTool("deploy_feature")` and ultimately `TaskRun.userId`, a NOT NULL
 * FK to `User` (`TaskRun_userId_fkey`). When the build has no `createdById` the
 * actor MUST resolve to the real install owner via `resolveScheduledOwnerUserId`
 * — NEVER a `"system"` sentinel. There is no `User` row with id `"system"`, so
 * the downstream write fails the FK with Prisma P2003. This is the same latent
 * bug fixed for the skill curator in PR #1925; it only surfaces here when a
 * `FeatureBuild` has a null `createdById`, so it never appears in normal flows.
 */
export async function autoDispatchShipForCompletedVerification(
  buildId: string,
  verificationStatus: "complete" | "skipped" = "complete",
): Promise<{ shipOutcome: string }> {
  const { prisma: db } = await import("@dpf/db");
  const b = await db.featureBuild.findUnique({
    where: { buildId },
    select: { createdById: true },
  });
  const { resolveScheduledOwnerUserId } = await import("../scheduled-owner");
  const actorUserId = b?.createdById ?? (await resolveScheduledOwnerUserId());
  const { dispatchShipForVerifiedBuild } = await import("@/lib/integrate/ship-on-review-approval");
  const outcome = await dispatchShipForVerifiedBuild({
    buildId,
    userId: actorUserId,
    verificationStatus,
  });
  return { shipOutcome: outcome.kind };
}
