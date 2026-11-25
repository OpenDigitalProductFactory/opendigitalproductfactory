import { pathToFileURL } from "node:url";
import { observeCiCapacityAtDaemon } from "../nonprod/local-ci-capacity-broker";
import { fenceEndedPreviewRuntimesAtDaemon } from "../nonprod/preview-runtime-fence";
import { sweepOrphanedPromoterContainersAtDaemon } from "../self-upgrade/promoter-sweep";
import { createDoctoolsActuator } from "../documents/conversion/doctools-actuator";
import { createSandboxSessionActuator } from "../workroom-runtime/sandbox-session-actuator";
import { createSandboxExecActuator } from "../workroom-runtime/sandbox-exec-actuator";

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
      promoterCandidate: (body: unknown) => Promise<unknown>;
      doctoolsImage: (body: unknown) => Promise<unknown>;
      reassessmentCandidate: (body: unknown) => Promise<unknown>;
      runtimeProtocol: (body: unknown) => Promise<unknown>;
      sandboxDb: (body: unknown, observeSandbox: () => Promise<{ name: string; running: boolean }>,
        resolveService: (service: "postgres" | "sandbox-postgres") => Promise<string>) => Promise<unknown>;
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
      const [{ createSwapFence, launchPromoterAtActuator, readPromoterInstallBinding }, { getSelfUpgradeConfig }, promoter,
        { runtimeTransitionHostContext }, { activeRuntimeTransitionIds }, { readFile }, { resolvePromoterTimeoutMs }] = await Promise.all([
        import("../self-upgrade/promoter-actuator"), import("../self-upgrade/config"), import("../self-upgrade/promoter"),
        import("./runtime-transition-host-context"), import("./runtime-capability-executor"), import("node:fs/promises"),
        import("../self-upgrade/promoter-timeout"),
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
        // BI-3C3CCC59: the actuator derives the swap's drain itself and re-checks it before reclaim and dispatch.
        swapFence: createSwapFence({
          liveDrainIds: async selfUpgradeRunId => {
            const [{ prisma }, { TERMINAL_QUIESCENCE_STATUSES }] = await Promise.all([import("@dpf/db"), import("../self-upgrade/quiescence-contract")]);
            return (await prisma.quiescenceRun.findMany({ where: { trigger: "self-upgrade", triggerRefId: selfUpgradeRunId,
              status: { notIn: [...TERMINAL_QUIESCENCE_STATUSES] } }, select: { runId: true } })).map(row => row.runId);
          },
          guard: async (quiescenceRunId, opts) => (await import("../self-upgrade/drain-admission")).guardAdmissionClosedForSwap(quiescenceRunId, opts),
          minimumRemainingMs: resolvePromoterTimeoutMs,
        }),
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
        const [{ createSourceWriterLauncher }, { readPromoterInstallBinding }, { getSelfUpgradeConfig }, { runProcessWithBudget },
          { readAppliedSkillRevision }, { createHash }] = await Promise.all([
          import("../self-upgrade/source-writer-actuator"), import("../self-upgrade/promoter-actuator"),
          import("../self-upgrade/config"), import("../shared/run-process-with-budget"),
          import("../skills/seed-writeback"), import("node:crypto"),
        ]);
        return createSourceWriterLauncher({
          binding: readPromoterInstallBinding(process.env),
          readConfig: getSelfUpgradeConfig,
          readRunStatus: async runId => {
            const { prisma } = await import("@dpf/db");
            return (await prisma.selfUpgradeRun.findUnique({ where: { runId }, select: { status: true } }))?.status ?? null;
          },
          readAppliedSkillRevision,
          sha256: content => createHash("sha256").update(content).digest("hex"),
          run: (args, options) => runProcessWithBudget("docker", args, options),
        });
      })();
      return (await sourceWriterLauncher)(body);
    },
    promoterCandidate: async body => {
      const [{ createCandidateLauncher }, { readPromoterInstallBinding }, { getSelfUpgradeConfig }, { runProcessWithBudget },
        { resolvePromoterArtifact }] = await Promise.all([
        import("../self-upgrade/promoter-candidate-actuator"), import("../self-upgrade/promoter-actuator"),
        import("../self-upgrade/config"), import("../shared/run-process-with-budget"), import("../self-upgrade/promoter"),
      ]);
      return createCandidateLauncher({
        binding: readPromoterInstallBinding(process.env),
        readConfig: getSelfUpgradeConfig,
        readRun: async runId => {
          const { prisma } = await import("@dpf/db");
          return prisma.selfUpgradeRun.findUnique({ where: { runId }, select: { status: true, deployedSha: true } });
        },
        inspectImageId: async reference => {
          const inspected = await runProcessWithBudget("docker", ["image", "inspect", "--format", "{{.Id}}", reference],
            { timeoutMs: 10_000, maxStdoutBytes: 1024 }).catch(() => null);
          return inspected?.exitCode === 0 ? inspected.stdout.trim() : null;
        },
        run: (args, options) => runProcessWithBudget("docker", args, options),
        resolve: params => resolvePromoterArtifact(params),
        readVerifiedRelease: async () => (await import("../release-health/state")).readFreshVerifiedReleaseTarget(),
      })(body);
    },
    doctoolsImage: async body => {
      const [{ createDoctoolsImageOperator }, { runProcessWithBudget }] = await Promise.all([
        import("../self-upgrade/doctools-image-actuator"), import("../shared/run-process-with-budget"),
      ]);
      return createDoctoolsImageOperator({
        ghcrOwner: process.env.GHCR_OWNER?.trim().toLowerCase(),
        run: (args, options) => runProcessWithBudget("docker", args, options),
      })(body);
    },
    reassessmentCandidate: async body => {
      const [{ createReassessmentCandidateProver }, { proveReassessmentCandidate }, { readFreshVerifiedReleaseTarget }, { runProcessWithBudget }] = await Promise.all([
        import("../self-upgrade/reassessment-candidate-actuator"), import("../self-upgrade/preflight"),
        import("../release-health/state"), import("../shared/run-process-with-budget"),
      ]);
      return createReassessmentCandidateProver({
        project,
        readRun: async runId => {
          const { prisma } = await import("@dpf/db");
          return prisma.selfUpgradeRun.findUnique({ where: { runId }, select: { status: true, deployedSha: true } });
        },
        readVerifiedRelease: () => readFreshVerifiedReleaseTarget(),
        prove: input => proveReassessmentCandidate({ ...input, runDocker: async args => {
          const nameIndex = args.indexOf("--name");
          return runProcessWithBudget("docker", args, { timeoutMs: 60_000, maxStdoutBytes: 8192,
            ...(nameIndex >= 0 ? { containerName: args[nameIndex + 1] } : {}) });
        } }),
      })(body);
    },
    // The probe has no mounts or launch authority; the snapshot is data bound
    // into the probe by hash, and a release must name the install's own owner.
    runtimeProtocol: async body => {
      const snapshot = body && typeof body === "object" && Object.keys(body).length === 1 ? (body as { observedHostSnapshot?: unknown }).observedHostSnapshot : undefined;
      if (snapshot === undefined || (snapshot !== null && (typeof snapshot !== "object" || Array.isArray(snapshot)))) throw new Error("runtime_protocol_admission_refused");
      const { inspectPackagedReconciliationProtocolAtDaemon } = await import("./runtime-capability-executor");
      return inspectPackagedReconciliationProtocolAtDaemon((snapshot ?? undefined) as never, process.env.GHCR_OWNER?.trim().toLowerCase() ?? "");
    },
    // A build's sandbox database steps, admitted on its in-use sandbox slot.
    sandboxDb: async (body, observeSandbox, resolveService) => {
      const [{ createSandboxDbOperator }, { runProcessWithBudget }, { spawn }] = await Promise.all([
        import("../build/sandbox/sandbox-db-actuator"), import("../shared/run-process-with-budget"), import("node:child_process"),
      ]);
      return createSandboxDbOperator({
        readSlot: async buildId => {
          const { prisma } = await import("@dpf/db");
          return prisma.sandboxSlot.findFirst({ where: { buildId }, select: { containerId: true, status: true } });
        },
        observeSandbox,
        resolveService,
        run: args => runProcessWithBudget("docker", args, { timeoutMs: 30_000, maxStdoutBytes: 4096 }),
        pipe: (from, to) => new Promise(resolve => {
          const source = spawn("docker", from, { stdio: ["ignore", "pipe", "pipe"] });
          const sink = spawn("docker", to, { stdio: ["pipe", "ignore", "pipe"] });
          let stderr = "", sourceCode: number | null | undefined, sinkCode: number | null | undefined;
          const timer = setTimeout(() => { source.kill("SIGTERM"); sink.kill("SIGTERM"); }, 10 * 60_000);
          const settle = () => {
            if (sourceCode === undefined || sinkCode === undefined) return;
            clearTimeout(timer);
            resolve({ exitCode: sourceCode === 0 && sinkCode === 0 ? 0 : 1, stderr: stderr.slice(-4096) });
          };
          source.stdout.pipe(sink.stdin);
          sink.stdin.on("error", () => source.kill("SIGTERM"));
          for (const child of [source, sink]) child.stderr.on("data", (chunk: Buffer) => { stderr = (stderr + chunk.toString("utf8")).slice(-8192); });
          source.once("error", () => { sourceCode = 1; settle(); });
          sink.once("error", () => { sinkCode = 1; settle(); });
          source.once("close", code => { sourceCode ??= code; settle(); });
          sink.once("close", code => { sinkCode ??= code; settle(); });
        }),
      })(body);
    },
    doctools: createDoctoolsActuator(project),
    // One stream transport, two owners: a Workroom session or a bounded
    // command in the observed sandbox (BI-224F56F1).
    openRuntimeSession: (() => {
      const session = createSandboxSessionActuator(), exec = createSandboxExecActuator();
      return (owner: unknown, observeSandbox: Parameters<typeof session>[1]) =>
        (owner && typeof owner === "object" && (owner as { kind?: unknown }).kind === "sandbox-exec" ? exec : session)(owner, observeSandbox);
    })(),
  });
}

void main().catch(() => {
  process.stderr.write("portal_actuator_startup_unavailable\n");
  process.exitCode = 78;
});
