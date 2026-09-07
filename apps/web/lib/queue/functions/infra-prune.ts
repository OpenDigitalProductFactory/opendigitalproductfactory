import { cron } from "inngest";
import { inngest } from "../inngest-client";
import { gateAtEntry } from "../quiescence-gates";

export const infraPrune = inngest.createFunction(
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
      const { exec } = await import("child_process");
      const util = await import("util");
      const execAsync = util.promisify(exec);
      const { planStaleImageReaping } = await import(
        "@/lib/infra/docker-image-retention"
      );

      // Every category reports what it actually did. The previous version wrapped
      // each block in `catch { /* Ignore errors */ }` and returned a flat
      // `{ prunedDockerDisk: true }`, so a run that deleted 200 images and a run
      // that silently failed were indistinguishable — which is why nobody could
      // tell that 68 promoter images had accumulated under a rule capping them at
      // 3 (BI-A53DFC81, `make-silent-failures-observable`).
      const outcome: Record<string, unknown> = {};

      // Keep recent promoter images (last 3 tags).
      try {
        const { stdout } = await execAsync(
          "docker images dpf-promoter --format '{{.Repository}}:{{.Tag}}||{{.CreatedAt}}'",
        );
        const parsed = (stdout ?? "")
          .trim()
          .split("\n")
          .filter(Boolean)
          .map((line) => {
            const [tag, created] = line.split("||");
            return { tag, created: new Date(created).getTime() };
          })
          .sort((a, b) => b.created - a.created);

        const toDelete = parsed.slice(3).map((p) => p.tag);
        const removed: string[] = [];
        const failed: string[] = [];
        for (const tag of toDelete) {
          try {
            await execAsync(`docker image rm -f ${tag}`);
            removed.push(tag);
          } catch {
            failed.push(tag);
          }
        }
        outcome.promoter = { found: parsed.length, removed: removed.length, failed: failed.length };
      } catch (err) {
        outcome.promoter = { error: err instanceof Error ? err.message : String(err) };
      }

      // Per-branch local-integration images. `docker image prune` below removes
      // only DANGLING images, and every one of these is TAGGED — so without this
      // block they are structurally invisible to this job and accumulate at ~5GB
      // each until the disk fills. That is what took the filesystem read-only and
      // killed Postgres on 2026-07-31.
      try {
        const [{ stdout: imageOut }, { stdout: containerOut }] = await Promise.all([
          execAsync(
            "docker images --format '{{.Repository}}||{{.Repository}}:{{.Tag}}||{{.CreatedAt}}'",
          ),
          execAsync("docker ps -a --format '{{.Image}}'"),
        ]);

        const images = (imageOut ?? "")
          .trim()
          .split("\n")
          .filter(Boolean)
          .map((line) => {
            const [repository, tag, created] = line.split("||");
            return { repository, tag, createdAt: new Date(created).getTime() };
          });
        const inUse = (containerOut ?? "").trim().split("\n").filter(Boolean);

        const stale = planStaleImageReaping({ images, inUse, now: Date.now() });
        const removed: string[] = [];
        const failed: string[] = [];
        for (const tag of stale) {
          try {
            // No -f: if something unexpectedly references it, refusing is correct.
            await execAsync(`docker image rm ${tag}`);
            removed.push(tag);
          } catch {
            failed.push(tag);
          }
        }
        outcome.staleBranchImages = {
          scanned: images.length,
          planned: stale.length,
          removed: removed.length,
          failed: failed.length,
        };
      } catch (err) {
        outcome.staleBranchImages = { error: err instanceof Error ? err.message : String(err) };
      }

      // Dangling images and build cache.
      try {
        await execAsync("docker image prune -f --filter until=48h");
        await execAsync("docker builder prune -f --keep-storage 20gb");
        outcome.danglingAndCache = "pruned";
      } catch (err) {
        outcome.danglingAndCache = { error: err instanceof Error ? err.message : String(err) };
      }

      return { prunedDockerDisk: true, ...outcome };
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
