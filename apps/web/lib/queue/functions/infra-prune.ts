import { cron } from "@/lib/jobs/triggers";
import { jobs } from "@/lib/jobs";
import { gateAtEntry } from "../quiescence-gates";

export const infraPrune = jobs.createFunction(
  { id: "ops/infra-prune", retries: 2, triggers: [cron("0 3 * * 0")] },
  async ({ step }) => {
    const gate = await gateAtEntry(step, "ops/infra-prune");
    if (!gate.proceed) return { skipped: true, reason: gate.reason };

    await step.run("prune-stale", async () => {
      // pruneStaleInfraCIs prunes stale InfrastructureCI *database* rows —
      // not Docker images. Docker disk cleanup is the next step.
      const { pruneStaleInfraCIs, prisma } = await import("@dpf/db");
      const { computeNextRunAt } = await import("@/lib/ai-provider-types");

      const result = await pruneStaleInfraCIs({
        markDecommissionedAfterDays: 30,
        deleteAfterDays: 90,
      });

      const now = new Date();
      await prisma.scheduledJob.update({
        where: { jobId: "infra-ci-prune" },
        data: {
          lastRunAt: now,
          lastStatus: "ok",
          lastError: null,
          nextRunAt: computeNextRunAt("weekly", now),
        },
      }).catch(() => {});

      return result;
    });

    await step.run("prune-docker-disk", async () => {
      // The private actuator runs the fixed prune when it is mounted; the
      // daemon path stays only for installs on the legacy recipe.
      const { pruneDockerDisk } = await import("@/lib/infra/docker-disk-prune");
      return pruneDockerDisk();
    });

    // Defense-in-depth: pollDeviceFlow self-deletes its session on the
    // expired/denied/poll-discovered-expiry paths, but a session whose owner
    // never returns to poll would otherwise sit in the table indefinitely.
    // Once a week is plenty for a 15-min-TTL transient.
    await step.run("prune-device-code-sessions", async () => {
      const { cleanupExpiredDeviceCodeSessions } = await import(
        "@/lib/build/github-oauth"
      );
      const removed = await cleanupExpiredDeviceCodeSessions();
      return { removedDeviceCodeSessions: removed };
    });
  },
);
