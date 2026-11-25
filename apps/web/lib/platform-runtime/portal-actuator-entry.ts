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
      launchPromoter: (body: unknown) => Promise<unknown>;
      sourceWriter: (body: unknown) => Promise<unknown>;
    }): Promise<void>;
  };
  let previewPass: ReturnType<typeof fenceEndedPreviewRuntimesAtDaemon> | undefined;
  let promoterPass: ReturnType<typeof sweepOrphanedPromoterContainersAtDaemon> | undefined;
  let prunePass: Promise<unknown> | undefined;
  // One launcher per actuator process, so the upstream refresh bound holds.
  let sourceWriterLauncher: Promise<(body: unknown) => Promise<unknown>> | undefined;
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
    launchPromoter: async body => {
      // Call runPromoterAtDaemon: inside the actuator the private socket is
      // mounted too, so runPromoter would route back to itself.
      const [{ launchPromoterAtActuator, readPromoterInstallBinding }, { getSelfUpgradeConfig }, promoter,
        { runtimeTransitionHostContext }, { activeRuntimeTransitionIds }, { readFile }] = await Promise.all([
        import("../self-upgrade/promoter-actuator"), import("../self-upgrade/config"), import("../self-upgrade/promoter"),
        import("./runtime-transition-host-context"), import("./runtime-capability-executor"), import("node:fs/promises"),
      ]);
      const context = (host?: Record<string, unknown>) => { try { return [runtimeTransitionHostContext(host, process.env)]; } catch { return []; } };
      return launchPromoterAtActuator(body, {
        binding: readPromoterInstallBinding(process.env),
        readConfig: getSelfUpgradeConfig,
        // Install-derived candidates only: no snapshot, the current install
        // state, and the snapshot inside the signed envelope (which the
        // admitted launch then matches to its row under the admission lock).
        hostContexts: async params => {
          const installState = await readFile("/dpf-state/install-state.json", "utf8").then(text => JSON.parse(text) as Record<string, unknown>, () => undefined);
          let signed: Record<string, unknown> | undefined;
          try {
            const envelope = typeof params.runtimeCapabilityEnvelope === "string"
              ? JSON.parse(Buffer.from(params.runtimeCapabilityEnvelope, "base64url").toString("utf8")) as Record<string, unknown> : null;
            const reconciliation = envelope?.version !== 1 && envelope?.mode === "reconciliation" ? envelope.reconciliation as Record<string, unknown> | undefined : undefined;
            signed = reconciliation?.observedHost as Record<string, unknown> | undefined;
          } catch { signed = undefined; }
          return [...context(undefined), ...(installState ? context(installState) : []), ...(signed ? context(signed) : [])];
        },
        activeTransitionIds: activeRuntimeTransitionIds,
        run: promoter.runPromoterAtDaemon,
        readRunStatus: async runId => {
          const { prisma } = await import("@dpf/db");
          return (await prisma.selfUpgradeRun.findUnique({ where: { runId }, select: { status: true } }))?.status ?? null;
        },
        // Re-resolve the artifact from the admitted image and require the same
        // identity; the caller's artifact copy is never trusted.
        readiness: async params => {
          const artifact = await promoter.resolvePromoterArtifact({ promoterImage: params.promoterImage, targetSha: params.targetSha });
          if (artifact.digest !== params.promoterImage) throw new Error("promoter_actuator_artifact_mismatch");
          return promoter.runPromoterReadinessAtDaemon({ ...params, artifact });
        },
      });
    },
    sourceWriter: async body => {
      sourceWriterLauncher ??= (async () => {
        const [{ createSourceWriterLauncher }, { readPromoterInstallBinding }, { getSelfUpgradeConfig }, { runProcessWithBudget }] = await Promise.all([
          import("../self-upgrade/source-writer-actuator"), import("../self-upgrade/promoter-actuator"),
          import("../self-upgrade/config"), import("../shared/run-process-with-budget"),
        ]);
        return createSourceWriterLauncher({
          binding: readPromoterInstallBinding(process.env),
          readConfig: getSelfUpgradeConfig,
          readRunStatus: async runId => {
            const { prisma } = await import("@dpf/db");
            return (await prisma.selfUpgradeRun.findUnique({ where: { runId }, select: { status: true } }))?.status ?? null;
          },
          run: (args, options) => runProcessWithBudget("docker", args, options),
        });
      })();
      return (await sourceWriterLauncher)(body);
    },
    doctools: createDoctoolsActuator(project),
    openRuntimeSession: createSandboxSessionActuator(),
  });
}

void main().catch(() => {
  process.stderr.write("portal_actuator_startup_unavailable\n");
  process.exitCode = 78;
});
