/**
 * Inngest: build-review-verification
 *
 * Fires when a build transitions into the `review` phase (see
 * `advanceBuildPhase` in apps/web/lib/actions/build.ts). Drives the
 * coworker-driven UX verification pipeline end to end:
 *
 *   1. Load build + brief
 *   2. If no acceptance criteria, mark `uxVerificationStatus = "skipped"`
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

export const buildReviewVerification = inngest.createFunction(
  {
    id: "build/review-verification",
    retries: 1,
    concurrency: [{ limit: 2 }],
    triggers: [{ event: "build/review.verify" }],
  },
  async ({ event, step }) => {
    const { buildId } = event.data as { buildId: string };

    const build = await step.run("load-build", async () => {
      const { prisma } = await import("@dpf/db");
      return prisma.featureBuild.findUnique({
        where: { buildId },
        select: { sandboxId: true, sandboxPort: true, brief: true, threadId: true, kind: true },
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

    if (testCases.length === 0) {
      await step.run("mark-skipped", async () => {
        const { prisma } = await import("@dpf/db");
        await prisma.featureBuild.update({
          where: { buildId },
          data: { uxVerificationStatus: "skipped" },
        });
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
      return { status: "skipped", testCount: 0 };
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
      await step.run("auto-dispatch-ship", async () => {
        const { prisma: db } = await import("@dpf/db");
        const b = await db.featureBuild.findUnique({
          where: { buildId },
          select: { createdById: true },
        });
        const actorUserId = b?.createdById ?? "system";
        const { dispatchShipForVerifiedBuild } = await import("@/lib/integrate/ship-on-review-approval");
        const outcome = await dispatchShipForVerifiedBuild({
          buildId,
          userId: actorUserId,
          verificationStatus: "complete",
        });
        return { shipOutcome: outcome.kind };
      });
    }

    return { status: finalStatus, passed: steps.filter((s) => s.passed).length, total: steps.length };
  },
);
