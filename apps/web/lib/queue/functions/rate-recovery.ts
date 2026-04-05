import { inngest } from "../inngest-client";

export const rateRecovery = inngest.createFunction(
  {
    id: "ops/rate-recovery",
    retries: 1,
    triggers: [{ event: "ops/rate.recover" }],
  },
  async ({ event, step }) => {
    await step.sleep("recovery-delay", "60s");
    await step.run("restore-provider", async () => {
      const { prisma } = await import("@dpf/db");
      await prisma.modelProfile.updateMany({
        where: {
          providerId: event.data.providerId,
          modelId: event.data.modelId,
          modelStatus: "degraded",
        },
        data: { modelStatus: "active" },
      });
    });
  },
);
