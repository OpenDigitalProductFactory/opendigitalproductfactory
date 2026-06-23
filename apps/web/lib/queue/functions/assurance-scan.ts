import { inngest } from "../inngest-client";
import { buildPipelineConcurrency } from "../admission";

export const assuranceScanRun = inngest.createFunction(
  {
    id: "assurance/scan-run",
    retries: 1,
    concurrency: buildPipelineConcurrency({ limit: 2 }),
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
        // Close the "lost queue": genuine findings auto-file as backlog items
        // through the shared front door — no manual per-finding click. Reconciled
        // against main first (accepted-baseline + stale-version) so stale/accepted
        // findings never spawn phantom work; fails closed if context is missing.
        autoFile: { enabled: true },
      });
    });
  },
);
