/**
 * Enqueue the build/review.verify Inngest job for a build entering the
 * review phase.
 *
 * Why this exists separately from the Inngest function: when the queue
 * itself is unreachable (inngest container down, network partition), a
 * silent enqueue failure used to leave `FeatureBuild.uxVerificationStatus`
 * permanently `null`. The review->ship phase gate in
 * `apps/web/lib/explore/feature-build-types.ts` interprets that as
 * "verification has not run yet" and blocks the build forever with no
 * legible reason. This wrapper guarantees that on enqueue failure the
 * build moves to a recoverable failed state with a written reason that
 * surfaces in the Review panel — `requeueBuildReviewVerification` is the
 * retry path once infra is back.
 */
export async function queueBuildReviewVerification(buildId: string): Promise<void> {
  try {
    const { inngest } = await import("@/lib/queue/inngest-client");
    await inngest.send({ name: "build/review.verify", data: { buildId } });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      `[tool-trace] build/review.verify enqueue failed buildId=${JSON.stringify(buildId)} error=${JSON.stringify(message)}`,
    );
    await markVerificationEnqueueFailed(buildId, message).catch((persistErr) => {
      console.error(
        `[tool-trace] failed to mark uxVerificationStatus=failed buildId=${JSON.stringify(buildId)} error=${
          JSON.stringify(persistErr instanceof Error ? persistErr.message : String(persistErr))
        }`,
      );
    });
  }
}

async function markVerificationEnqueueFailed(buildId: string, reason: string): Promise<void> {
  const { prisma } = await import("@dpf/db");
  const { saveBuildArtifactRevisionWithDb } = await import("@/lib/build/build-artifact-provenance");

  const build = await prisma.featureBuild.findUnique({
    where: { buildId },
    select: { threadId: true },
  });

  const failedStep = [
    {
      step: "Queue verification job",
      passed: false,
      screenshotUrl: null,
      error: `Inngest queue unavailable: ${reason.slice(0, 300)}`,
    },
  ];

  await saveBuildArtifactRevisionWithDb(prisma, {
    buildId,
    field: "uxTestResults",
    savedByUserId: "system",
    value: failedStep,
  });

  await prisma.featureBuild.update({
    where: { buildId },
    data: { uxVerificationStatus: "failed" },
  });

  if (build?.threadId) {
    const { agentEventBus } = await import("@/lib/agent-event-bus");
    agentEventBus.emit(build.threadId, {
      type: "verification:complete",
      buildId,
      passed: 0,
      total: 1,
      status: "failed",
    });
  }
}
