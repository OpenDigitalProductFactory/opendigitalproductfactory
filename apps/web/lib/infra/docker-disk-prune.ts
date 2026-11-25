// Weekly Docker disk reclamation for ops/infra-prune (BI-A53DFC81).
//
// The immutable portal has no Docker socket (BI-224F56F1). When the private
// actuator is mounted the portal asks it to run this fixed, parameterless
// prune; the actuator runs pruneDockerDiskAtDaemon with its own daemon access.
// A refused or failed actuator call is reported, never retried locally.

import { getErrorMessage } from "@/lib/shared/get-error-message";
import { planStaleImageReaping } from "./docker-image-retention";

export type DiskPruneExec = (command: string) => Promise<{ stdout: string }>;

export type DiskPruneActuatorPort = {
  available(): Promise<boolean>;
  prune(): Promise<Record<string, unknown>>;
};

const privateActuatorPrune: DiskPruneActuatorPort = {
  available: async () => {
    const { usesPrivateActuator } = await import("../../../../scripts/lib/scope-writer-observation.mjs");
    return usesPrivateActuator();
  },
  prune: async () => {
    const { pruneActuatorDockerDisk } = await import("../../../../scripts/lib/scope-writer-observation.mjs");
    return (await pruneActuatorDockerDisk()) as Record<string, unknown>;
  },
};

async function defaultExec(): Promise<DiskPruneExec> {
  const { exec } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const execAsync = promisify(exec);
  return async (command) => ({ stdout: String((await execAsync(command)).stdout ?? "") });
}

export async function pruneDockerDisk(ports: { actuator?: DiskPruneActuatorPort; exec?: DiskPruneExec } = {}): Promise<Record<string, unknown>> {
  const actuator = ports.actuator ?? privateActuatorPrune;
  if (await actuator.available()) {
    try {
      return await actuator.prune();
    } catch {
      return { prunedDockerDisk: false, error: "actuator_prune_unavailable" };
    }
  }
  return pruneDockerDiskAtDaemon(ports.exec ?? await defaultExec());
}

/**
 * Every category reports what it actually did. The previous version wrapped
 * each block in `catch { /* Ignore errors *\/ }` and returned a flat
 * `{ prunedDockerDisk: true }`, so a run that deleted 200 images and a run
 * that silently failed were indistinguishable — which is why nobody could
 * tell that 68 promoter images had accumulated under a rule capping them at
 * 3 (BI-A53DFC81, `make-silent-failures-observable`).
 */
export async function pruneDockerDiskAtDaemon(execAsync: DiskPruneExec): Promise<Record<string, unknown>> {
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
    outcome.promoter = { error: getErrorMessage(err) };
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
    outcome.staleBranchImages = { error: getErrorMessage(err) };
  }

  // Dangling images and build cache.
  try {
    await execAsync("docker image prune -f --filter until=48h");
    await execAsync("docker builder prune -f --keep-storage 20gb");
    outcome.danglingAndCache = "pruned";
  } catch (err) {
    outcome.danglingAndCache = { error: getErrorMessage(err) };
  }

  return { prunedDockerDisk: true, ...outcome };
}
