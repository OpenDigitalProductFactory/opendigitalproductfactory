import { pathToFileURL } from "node:url";
import { observeCiCapacityAtDaemon } from "../nonprod/local-ci-capacity-broker";
import { fenceEndedPreviewRuntimesAtDaemon } from "../nonprod/preview-runtime-fence";

async function main() {
  // Use the same immutable promoter closure shipped for this image's
  // canonical readiness and signing paths.
  const ownerPath = pathToFileURL("/promoter/scripts/promoter-epoch-evidence.mjs").href;
  const { serveScopeWriterObserver } = await import(ownerPath) as {
    serveScopeWriterObserver(env: NodeJS.ProcessEnv, owners: {
      fencePreviews: typeof fenceEndedPreviewRuntimesAtDaemon;
      observeCiCapacity: typeof observeCiCapacityAtDaemon;
      reconcileSubstrate: () => Promise<unknown>;
    }): Promise<void>;
  };
  let previewPass: ReturnType<typeof fenceEndedPreviewRuntimesAtDaemon> | undefined;
  await serveScopeWriterObserver(process.env, {
    fencePreviews: () => {
      previewPass ??= fenceEndedPreviewRuntimesAtDaemon().finally(() => { previewPass = undefined; });
      return previewPass;
    },
    observeCiCapacity: observeCiCapacityAtDaemon,
    reconcileSubstrate: async () => {
      const { reconcileSubstrateAtDaemon } = await import("../queue/functions/substrate-reconciler");
      return reconcileSubstrateAtDaemon(process.env.PROMOTE_COMPOSE_PROJECT);
    },
  });
}

void main().catch(() => {
  process.stderr.write("portal_actuator_startup_unavailable\n");
  process.exitCode = 78;
});
