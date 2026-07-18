import { prisma } from "@dpf/db";
import { readFile } from "node:fs/promises";
import { classifyRuntimeInstallState, reconcileRuntimeCapabilityTransitions, type RuntimeTransitionReconcileRow } from "./transition-coordinator";
import { signTransitionPayload, verifyHistoricalTransitionReceipt, type RuntimeTransitionEnvelope, type RuntimeTransitionReceipt } from "./transition-protocol";
import { runPromoter } from "@/lib/self-upgrade/promoter";

let admission: "reconciling" | "ready" | "recovery_required" = "reconciling";

export async function assertRuntimeCapabilityTransitionAdmission(): Promise<void> {
  // DB-global truth is authoritative across portal replicas and restarts. The
  // local state only closes the narrow interval before the startup query runs.
  const [active, recovery] = await Promise.all([
    prisma.runtimeCapabilityTransition.count({ where: { status: { in: ["pending", "applying", "host_applied", "compensating"] } } }),
    prisma.runtimeCapabilityTransition.count({ where: { status: "rollback_failed", failure: { path: ["recoveryRequired"], equals: true } } }),
  ]);
  if (recovery > 0 || admission === "recovery_required") throw new Error("runtime_capability_recovery_required");
  if (active > 0 || admission !== "ready") throw new Error("runtime_capability_reconciliation_in_progress");
}

const receiptPath = (id: string) => `/dpf-state/runtime-capability-transitions/${id}.json`;
type InstallStateIdentity = Parameters<typeof classifyRuntimeInstallState>[0];
async function readReceipt(id: string): Promise<RuntimeTransitionReceipt | null> {
  try { return JSON.parse(await readFile(receiptPath(id), "utf8")) as RuntimeTransitionReceipt; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
}

function promoterParams(row: RuntimeTransitionReconcileRow, envelope: RuntimeTransitionEnvelope, signature: string) {
  const hostInstallPath = process.env.DPF_HOST_INSTALL_PATH;
  const stateDirHostPath = process.env.DPF_STATE_DIR_HOST;
  const secretPath = process.env.DPF_RUNTIME_TRANSITION_SECRET_FILE_HOST;
  if (!hostInstallPath || !stateDirHostPath || !secretPath) throw new Error("runtime_transition_host_configuration_missing");
  return {
    hostInstallPath, stateDirHostPath, runtimeCapabilitySecretFileHostPath: secretPath,
    targetSha: process.env.DEPLOYED_SHA ?? "runtime-capability-transition", backupPath: "/backups/runtime-capability-transition",
    healthUrl: `${process.env.APP_URL ?? "http://localhost:3000"}/api/health`,
    composeFiles: (process.env.DPF_SELF_UPGRADE_COMPOSE_FILES ?? "docker-compose.yml").split(/\s+/).filter(Boolean),
    composeProject: process.env.COMPOSE_PROJECT_NAME ?? "dpf", runtimeCapabilityTransitionId: row.transitionId,
    runtimeCapabilityEnvelope: Buffer.from(JSON.stringify(envelope)).toString("base64url"), runtimeCapabilitySignature: signature,
    containerName: `dpf-promoter-${row.transitionId}`, timeoutMs: 600_000,
  };
}

export async function createProductionRuntimeTransitionHost() {
  const protocolSecret = (await readFile("/dpf-state/runtime-transition.secret", "utf8")).trim();
  // Validate strength before querying/replaying any durable authority.
  signTransitionPayload({ version: 1, transitionId: "RCT-secret-check", issuedAt: new Date(0).toISOString(), expiresAt: new Date(1).toISOString(), catalogHash: "0".repeat(64), previousStateHash: "0".repeat(64), desiredStateHash: "0".repeat(64), previousKeys: [], desiredKeys: [], previousProfiles: [], desiredProfiles: [], previousServices: [], desiredServices: [] }, protocolSecret);
  return {
    protocolSecret,
    readReceipt,
    reconcileAuthority: async (activeTransitionIds: string[]) => {
      const hostInstallPath = process.env.DPF_HOST_INSTALL_PATH;
      const stateDirHostPath = process.env.DPF_STATE_DIR_HOST;
      if (!hostInstallPath || !stateDirHostPath) throw new Error("runtime_transition_host_configuration_missing");
      const result = await runPromoter({ hostInstallPath, stateDirHostPath, targetSha: process.env.DEPLOYED_SHA ?? "runtime-capability-transition", backupPath: "/backups/runtime-capability-transition", healthUrl: `${process.env.APP_URL ?? "http://localhost:3000"}/api/health`, runtimeTransitionAuthorityOperation: "reconcile", runtimeTransitionActiveIds: activeTransitionIds, containerName: "dpf-promoter-authority-reconcile", timeoutMs: 60_000 });
      if (result.exitCode !== 0) throw new Error("runtime_transition_authority_reconcile_failed");
    },
    relaunch: async (row: RuntimeTransitionReconcileRow) => {
      if (!row.envelope || !row.envelopeSignature) throw new Error("transition_envelope_identity_missing");
      const result = await runPromoter(promoterParams(row, row.envelope, row.envelopeSignature));
      if (result.exitCode !== 0 && result.exitCode !== 75) throw new Error("runtime_transition_relaunch_failed");
    },
    compensate: async (row: RuntimeTransitionReconcileRow, reason: string) => {
      if (!row.envelope) throw new Error("transition_envelope_identity_missing");
      const now = Date.now();
      const reverse: RuntimeTransitionEnvelope = { ...row.envelope, issuedAt: new Date(now).toISOString(), expiresAt: new Date(now + 600_000).toISOString(),
        previousStateHash: row.desiredStateHash, desiredStateHash: row.previousStateHash,
        previousKeys: row.desiredKeys, desiredKeys: row.previousKeys, previousProfiles: row.desiredProfiles, desiredProfiles: row.previousProfiles,
        previousServices: row.desiredServices, desiredServices: row.previousServices };
      const result = await runPromoter(promoterParams(row, reverse, signTransitionPayload(reverse, protocolSecret)));
      if (result.exitCode !== 0) throw new Error("runtime_transition_compensation_failed");
      const receipt = await readReceipt(row.transitionId);
      if (!receipt || verifyHistoricalTransitionReceipt(receipt, protocolSecret, reverse) !== "applied") throw new Error("runtime_transition_compensation_receipt_invalid");
      await prisma.$transaction(async (tx) => {
        await tx.runtimeCapabilityTransition.update({ where: { transitionId: row.transitionId }, data: { status: "rolled_back", hostReceipt: receipt, failure: { code: reason }, completedAt: new Date() } });
        await tx.runtimeCapabilityTransitionEvent.create({ data: { transitionId: row.transitionId, outcome: "rolled_back", detail: { receipt, reason, source: "startup-reconciler" } } });
      });
    },
  };
}

/** Production DB adapter. Host IO remains explicit so startup cannot silently
 * claim readiness when the /dpf-state mount or promoter is unavailable. */
export async function reconcileRuntimeCapabilityTransitionsOnStartup(host: {
  readReceipt(transitionId: string): Promise<RuntimeTransitionReceipt | null>;
  relaunch(row: RuntimeTransitionReconcileRow): Promise<void>;
  compensate(row: RuntimeTransitionReconcileRow, reason: string): Promise<void>;
  protocolSecret: string;
  reconcileAuthority?(activeTransitionIds: string[]): Promise<void>;
}): Promise<void> {
  admission = "reconciling";
  let recoveryRequired = false;
  const listActive = async () => prisma.runtimeCapabilityTransition.findMany({
    where: { status: { in: ["pending", "applying", "host_applied", "compensating"] } },
    orderBy: { createdAt: "asc" },
    select: { transitionId: true, status: true, catalogHash: true, previousStateHash: true, desiredStateHash: true, previousKeys: true, desiredKeys: true, previousProfiles: true, desiredProfiles: true, previousServices: true, desiredServices: true, previousStates: true, desiredStates: true, envelope: true, envelopeSignature: true, createdAt: true },
  }) as unknown as Promise<RuntimeTransitionReconcileRow[]>;
  const startupRows = await listActive();
  await host.reconcileAuthority?.(startupRows.map((row) => row.transitionId));
  await reconcileRuntimeCapabilityTransitions({
    listActive: async () => startupRows,
    readHostReceipt: host.readReceipt,
    protocolSecret: host.protocolSecret,
    relaunch: host.relaunch,
    compensate: host.compensate,
    inspectHostInstallState: async (row) => {
      try {
        // Journal phase is deliberately ignored. The process can die after
        // rename(install-state) and before advancing a prepared journal.
        const state = JSON.parse(await readFile("/dpf-state/install-state.json", "utf8")) as InstallStateIdentity;
        return classifyRuntimeInstallState(state, row);
      }
      catch { return "unknown"; }
    },
    markCleanPrevious: async (row, reason) => {
      await prisma.$transaction(async (tx) => {
        await tx.runtimeCapabilityTransition.update({ where: { transitionId: row.transitionId }, data: { status: "failed", failure: { code: reason }, completedAt: new Date() } });
        await tx.runtimeCapabilityTransitionEvent.create({ data: { transitionId: row.transitionId, outcome: "failed", detail: { reason, source: "startup-reconciler" } } });
      });
    },
    completeFromReceipt: async (row, receipt) => {
      await prisma.$transaction(async (tx) => {
        for (const [capabilityId, state] of Object.entries(row.desiredStates)) await tx.platformCapability.update({ where: { capabilityId }, data: { state } });
        await tx.runtimeCapabilityTransition.update({ where: { transitionId: row.transitionId }, data: { status: "succeeded", hostReceipt: receipt, completedAt: new Date() } });
        await tx.runtimeCapabilityTransitionEvent.create({ data: { transitionId: row.transitionId, outcome: "succeeded", detail: { receipt, source: "startup-reconciler" } } });
      });
    },
    classifyTerminalReceipt: async (row, receipt) => {
      const status = receipt.status === "rolled_back" ? "rolled_back" : receipt.status === "rollback_failed" ? "rollback_failed" : "failed";
      await prisma.$transaction(async (tx) => {
        await tx.runtimeCapabilityTransition.update({ where: { transitionId: row.transitionId }, data: { status, hostReceipt: receipt, failure: { code: receipt.failure ?? status }, completedAt: new Date() } });
        await tx.runtimeCapabilityTransitionEvent.create({ data: { transitionId: row.transitionId, outcome: status, detail: { receipt, source: "startup-reconciler" } } });
      });
      if (status === "rollback_failed") recoveryRequired = true;
    },
    markRecoveryRequired: async (row, reason) => {
      recoveryRequired = true;
      await prisma.$transaction(async (tx) => {
        await tx.runtimeCapabilityTransition.update({ where: { transitionId: row.transitionId }, data: { status: "rollback_failed", failure: { code: reason, recoveryRequired: true }, completedAt: new Date() } });
        await tx.runtimeCapabilityTransitionEvent.create({ data: { transitionId: row.transitionId, outcome: "rollback_failed", detail: { reason, source: "startup-reconciler" } } });
      });
    },
  });
  admission = recoveryRequired ? "recovery_required" : "ready";
}
