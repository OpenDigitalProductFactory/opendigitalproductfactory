import { inngest } from "../inngest-client";

export const assuranceBomGenerate = inngest.createFunction(
  {
    id: "assurance/bom-generate",
    retries: 1,
    concurrency: [{ limit: 2 }],
    triggers: [{ event: "assurance/bom.generate" }],
  },
  async ({ event, step }) => {
    const { buildId, requestedByUserId } = event.data as { buildId: string; requestedByUserId: string };

    return step.run("generate-and-persist-bom", async () => {
      const { prisma } = await import("@dpf/db");
      const { generateAndPersistBuildBom } = await import("@/lib/assurance/bom-job");
      return generateAndPersistBuildBom({
        db: prisma,
        buildId,
        requestedByUserId,
        projectRoot: process.env.PROJECT_ROOT ?? process.cwd(),
        now: new Date(),
      });
    });
  },
);
