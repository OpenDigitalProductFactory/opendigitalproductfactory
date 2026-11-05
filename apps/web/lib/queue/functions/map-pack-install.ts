import { jobs } from "@/lib/jobs";

/**
 * Fetch and install one street-map pack (BI-43BBCC26). Plan, one durable step
 * per download chunk, then finalize; a restarted run resumes at the next
 * unfinished step. Concurrency 1: one install at a time on the install.
 */
export const mapPackInstall = jobs.createFunction(
  {
    id: "map-pack/install",
    retries: 3,
    concurrency: [{ limit: 1 }],
    triggers: [{ event: "map-pack/install.requested" }],
    onFailure: async ({ event, error }) => {
      const { writeInstallStatus } = await import("@/lib/twin/map-pack-install/status.server");
      await writeInstallStatus({ state: "failed", error: error instanceof Error ? error.message : "The install stopped." }).catch(() => {});
      // A failed run's pre-allocated staging file would otherwise stay on the map volume.
      const packId = (event.data as { event?: { data?: { packId?: string } } }).event?.data?.packId;
      if (packId) {
        const { discardStaging } = await import("@/lib/twin/map-pack-install/install.server");
        await discardStaging(packId).catch(() => {});
      }
    },
  },
  async ({ event, step }) => {
    const request = event.data as import("@/lib/twin/map-pack-install/install.server").InstallRequest;
    const { chunkCount, totalBytes } = await step.run("plan", async () => {
      const { planInstall } = await import("@/lib/twin/map-pack-install/install.server");
      const { writeInstallStatus } = await import("@/lib/twin/map-pack-install/status.server");
      const planned = await planInstall(request);
      await writeInstallStatus({ state: "downloading", chunkCount: planned.chunkCount, totalBytes: planned.totalBytes, chunksDone: 0 });
      return planned;
    });
    for (let i = 0; i < chunkCount; i++) {
      await step.run(`chunk-${i}`, async () => {
        const { downloadChunk } = await import("@/lib/twin/map-pack-install/install.server");
        const { writeInstallStatus } = await import("@/lib/twin/map-pack-install/status.server");
        await downloadChunk(request.packId, i);
        await writeInstallStatus({ chunksDone: i + 1 });
        return null;
      });
    }
    await step.run("finalize", async () => {
      const { finalizeInstall } = await import("@/lib/twin/map-pack-install/install.server");
      const { writeInstallStatus } = await import("@/lib/twin/map-pack-install/status.server");
      await writeInstallStatus({ state: "finalizing" });
      await finalizeInstall(request.packId);
      await writeInstallStatus({ state: "done", error: null });
      return null;
    });
    return { packId: request.packId, totalBytes };
  },
);
