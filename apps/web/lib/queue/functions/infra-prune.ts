import { cron } from "inngest";
import { inngest } from "../inngest-client";
import { gateAtEntry } from "../quiescence-gates";

export const infraPrune = inngest.createFunction(
  { id: "ops/infra-prune", retries: 2, triggers: [cron("0 3 * * 0")] },
  async ({ step }) => {
    const gate = await gateAtEntry(step);
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
      const { exec } = await import("child_process");
      const util = await import("util");
      const execAsync = util.promisify(exec);

      // Keep recent promoter images (last 3 tags)
      try {
        const { stdout } = await execAsync("docker images dpf-promoter --format '{{.Repository}}:{{.Tag}}||{{.CreatedAt}}'");
        if (stdout) {
          const lines = stdout.trim().split("\n").filter(Boolean);
          const parsed = lines.map(line => {
            const [tag, created] = line.split("||");
            return { tag, created: new Date(created).getTime() };
          }).sort((a, b) => b.created - a.created);
          
          const toDelete = parsed.slice(3).map(p => p.tag);
          for (const tag of toDelete) {
            await execAsync(`docker image rm -f ${tag}`).catch(() => {});
          }
        }
      } catch (err) {
        // Ignore errors
      }

      // Prune dangling images and build cache
      try {
        await execAsync("docker image prune -f --filter until=48h");
        await execAsync("docker builder prune -f --keep-storage 20gb");
      } catch (err) {
        // Ignore errors
      }

      return { prunedDockerDisk: true };
    });

    // Defense-in-depth: pollDeviceFlow self-deletes its session on the
    // expired/denied/poll-discovered-expiry paths, but a session whose owner
    // never returns to poll would otherwise sit in the table indefinitely.
    // Once a week is plenty for a 15-min-TTL transient.
    await step.run("prune-device-code-sessions", async () => {
      const { cleanupExpiredDeviceCodeSessions } = await import(
        "@/lib/integrate/github-oauth"
      );
      const removed = await cleanupExpiredDeviceCodeSessions();
      return { removedDeviceCodeSessions: removed };
    });
  },
);
