import { pathToFileURL } from "node:url";
import { observeCiCapacityAtDaemon } from "../nonprod/local-ci-capacity-broker";
import { fenceEndedPreviewRuntimesAtDaemon } from "../nonprod/preview-runtime-fence";
import { sweepOrphanedPromoterContainersAtDaemon } from "../self-upgrade/promoter-sweep";
import { createDoctoolsActuator } from "../documents/conversion/doctools-actuator";
import { createSandboxSessionActuator } from "../workroom-runtime/sandbox-session-actuator";

async function main() {
  // Use the same immutable promoter closure shipped for this image's
  // canonical readiness and signing paths.
  const ownerPath = pathToFileURL("/promoter/scripts/promoter-epoch-evidence.mjs").href;
  const { serveScopeWriterObserver } = await import(ownerPath) as {
    serveScopeWriterObserver(env: NodeJS.ProcessEnv, owners: {
      fencePreviews: typeof fenceEndedPreviewRuntimesAtDaemon;
      observeCiCapacity: typeof observeCiCapacityAtDaemon;
      reconcileSubstrate: () => Promise<unknown>;
      sweepPromoters: () => Promise<unknown>;
      doctools: ReturnType<typeof createDoctoolsActuator>;
      openRuntimeSession: ReturnType<typeof createSandboxSessionActuator>;
      pruneDockerDisk: () => Promise<unknown>;
    }): Promise<void>;
  };
  let previewPass: ReturnType<typeof fenceEndedPreviewRuntimesAtDaemon> | undefined;
  let promoterPass: ReturnType<typeof sweepOrphanedPromoterContainersAtDaemon> | undefined;
  let prunePass: Promise<unknown> | undefined;
  const project = process.env.PROMOTE_COMPOSE_PROJECT;
  if (!project) throw new Error("actuator_project_unavailable");
  await serveScopeWriterObserver(process.env, {
    fencePreviews: () => {
      previewPass ??= fenceEndedPreviewRuntimesAtDaemon().finally(() => { previewPass = undefined; });
      return previewPass;
    },
    observeCiCapacity: observeCiCapacityAtDaemon,
    reconcileSubstrate: async () => {
      const { reconcileSubstrateAtDaemon } = await import("../queue/functions/substrate-reconciler");
      return reconcileSubstrateAtDaemon(project);
    },
    sweepPromoters: () => {
      promoterPass ??= sweepOrphanedPromoterContainersAtDaemon({ project }).finally(() => { promoterPass = undefined; });
      return promoterPass;
    },
    pruneDockerDisk: () => {
      prunePass ??= (async () => {
        const { pruneDockerDiskAtDaemon } = await import("../infra/docker-disk-prune");
        const { exec } = await import("node:child_process");
        const { promisify } = await import("node:util");
        const run = promisify(exec);
        return pruneDockerDiskAtDaemon(async command => ({ stdout: String((await run(command)).stdout ?? "") }));
      })().finally(() => { prunePass = undefined; });
      return prunePass;
    },
    doctools: createDoctoolsActuator(project),
    openRuntimeSession: createSandboxSessionActuator(),
  });
}

void main().catch(() => {
  process.stderr.write("portal_actuator_startup_unavailable\n");
  process.exitCode = 78;
});
