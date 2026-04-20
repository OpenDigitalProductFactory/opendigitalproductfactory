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
        select: { sandboxId: true, sandboxPort: true, brief: true, threadId: true },
      });
    });

    if (!build || !build.sandboxId || !build.sandboxPort) {
      return { skipped: true, reason: "sandbox or build missing" };
    }

    const brief = build.brief as { acceptanceCriteria?: string[] } | null;
    const testCases = brief?.acceptanceCriteria ?? [];

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
    const finalStatus: "complete" | "failed" = allPass ? "complete" : "failed";

    await step.run("persist-results", async () => {
      const { prisma } = await import("@dpf/db");
      await prisma.featureBuild.update({
        where: { buildId },
        data: {
          uxTestResults: steps as unknown as import("@dpf/db").Prisma.InputJsonValue,
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

    return { status: finalStatus, passed: steps.filter((s) => s.passed).length, total: steps.length };
  },
);
