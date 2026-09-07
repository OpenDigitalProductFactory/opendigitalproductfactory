import { cron } from "inngest";
import { inngest } from "../inngest-client";
import { gateAtEntry } from "../quiescence-gates";

// jobId of the catalog ScheduledJob row this cron corresponds to.
const JOB_ID = "routing-reachability-preflight";

/**
 * Stamp the catalog ScheduledJob row (upsert — self-heals a missing
 * registration instead of throwing P2025). Best-effort: never fail the job
 * over a stamp.
 */
async function recordRun(status: "ok" | "error", error?: string): Promise<void> {
  const { prisma } = await import("@dpf/db");
  const now = new Date();
  await prisma.scheduledJob
    .upsert({
      where: { jobId: JOB_ID },
      create: {
        jobId: JOB_ID,
        name: "Coworker routing reachability preflight",
        schedule: "37 */6 * * *",
        lastRunAt: now,
        lastStatus: status,
        lastError: error ?? null,
      },
      update: { lastRunAt: now, lastStatus: status, lastError: error ?? null },
    })
    .catch(() => {});
}

/**
 * BI-E2CCFAC1 — ask the router, on a schedule, whether every production
 * coworker can still reach an eligible model (including at the
 * payload-screening escalation ceiling), and raise/resolve the owner-visible
 * issue accordingly. Both routing dead-ends this BI documents sat invisible
 * for weeks because nothing asked until a human typed a message.
 */
export const routingReachabilityPreflight = inngest.createFunction(
  {
    id: "inference/routing-reachability-preflight",
    retries: 1,
    concurrency: { limit: 1, scope: "fn" },
    triggers: [cron("37 */6 * * *")], // every 6h, offset to avoid the :00/:10 batches
  },
  async ({ step }) => {
    const gate = await gateAtEntry(step, "inference/routing-reachability-preflight");
    if (!gate.proceed) return { skipped: true, reason: gate.reason };

    try {
      const summary = await step.run("preflight-coworker-routing", async () => {
        const { runRoutingReachabilityPreflight } = await import(
          "@/lib/coworker-service-catalog/routing-reachability-preflight"
        );
        const result = await runRoutingReachabilityPreflight();
        return {
          checked: result.checked,
          blocked: result.blocked.map((b) => b.agentId),
        };
      });
      await step.run("record-success", () => recordRun("ok"));
      return summary;
    } catch (err) {
      await step.run("record-failure", () => recordRun("error", String(err).slice(0, 500)));
      throw err;
    }
  },
);
