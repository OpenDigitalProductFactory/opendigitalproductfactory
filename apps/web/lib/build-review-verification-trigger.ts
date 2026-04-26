export async function queueBuildReviewVerification(buildId: string): Promise<void> {
  try {
    const { inngest } = await import("@/lib/queue/inngest-client");
    await inngest.send({ name: "build/review.verify", data: { buildId } });
  } catch (err) {
    console.error(`[build] build/review.verify enqueue failed for ${buildId}:`, err);
  }
}
