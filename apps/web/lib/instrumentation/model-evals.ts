// First-boot model-eval instrumentation helpers. Imported only by the Node instrumentation entrypoint.

import { getErrorMessage } from "@/lib/shared/get-error-message";

export async function enqueueFirstBootEvals(providerId: string): Promise<{
  enqueued: number;
  error: string | null;
}> {
  if (process.env.NEXT_RUNTIME && process.env.NEXT_RUNTIME !== "nodejs") return { enqueued: 0, error: null };
  try {
    const { prisma } = await import("@dpf/db");
    const profiles = await prisma.modelProfile.findMany({
      where: {
        providerId,
        modelStatus: "active",
        retiredAt: null,
      },
      select: { modelId: true },
    });
    if (profiles.length === 0) return { enqueued: 0, error: null };

    const { inngest } = await import("@/lib/queue/inngest-client");
    await inngest.send(
      profiles.map((p) => ({
        name: "ai/eval.run",
        data: {
          endpointId: providerId,
          modelId: p.modelId,
          userId: "first-boot",
        },
      })),
    );
    console.log(
      `[first-boot] Enqueued ${profiles.length} dimension eval(s) for ${providerId} (background via Inngest)`,
    );
    return { enqueued: profiles.length, error: null };
  } catch (err) {
    const msg = getErrorMessage(err);
    console.warn(`[first-boot] Failed to enqueue evals for ${providerId}: ${msg}`);
    return { enqueued: 0, error: msg };
  }
}
