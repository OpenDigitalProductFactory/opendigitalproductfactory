import { inngest } from "../inngest-client";

export const assuranceScanRun = inngest.createFunction(
  {
    id: "assurance/scan-run",
    retries: 1,
    concurrency: [{ limit: 2 }],
    triggers: [{ event: "assurance/scan.run" }],
  },
  async ({ event, step }) => {
    const { buildId, requestedByUserId } = event.data as { buildId: string; requestedByUserId: string };

    return step.run("run-pnpm-audit-scan", async () => {
      const { prisma } = await import("@dpf/db");
      const { runBuildAssuranceScan } = await import("@/lib/assurance/scan-job");
      return runBuildAssuranceScan({
        db: prisma,
        buildId,
        requestedByUserId,
        projectRoot: process.env.PROJECT_ROOT ?? process.cwd(),
        now: new Date(),
      });
    });
  },
);
