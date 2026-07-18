import { createHash } from "node:crypto";
import type { PromoterParams, PromoterResult } from "@/lib/self-upgrade/promoter";
import { signTransitionPayload, type RuntimeTransitionEnvelope, type RuntimeTransitionReceipt, verifyTransitionReceipt } from "./transition-protocol";

export const ACTIVE_RUNTIME_TRANSITION_STATUSES = ["pending", "applying", "host_applied", "compensating"] as const;

export function computeCapabilityStateVersion(catalogHash: string, states: Readonly<Record<string, string>>): string {
  // Capability IDs/states are closed below, making the plan's newline/equal
  // serialization canonical and unambiguous.
  const stateLines = Object.entries(states).map(([id, state]) => `${id}=${state}`).sort().join("\n");
  return createHash("sha256").update(`${catalogHash}\n${stateLines}`).digest("hex");
}

export type RuntimeCapabilityTransitionRequest = {
  transitionId: string;
  catalogHash: string;
  previousKeys: readonly string[];
  desiredKeys: readonly string[];
  previousStates: Readonly<Record<string, string>>;
  desiredStates: Readonly<Record<string, string>>;
  requestedById: string;
};

export interface RuntimeCapabilityTransitionReceipts {
  /** Implementations serialize with an advisory lock + the DB partial unique index. */
  createPending(input: RuntimeCapabilityTransitionRequest & { previousStateHash: string; desiredStateHash: string; previousProfiles: string[]; desiredProfiles: string[] }): Promise<
    | { created: true }
    | { created: false; kind: "replay"; status: string }
    | { created: false; kind: "active_conflict"; status: string; transitionId: string }
  >;
  markFailed(transitionId: string, failure: string): Promise<void>;
  markHostApplied(transitionId: string): Promise<void>;
  commitSuccess?(transitionId: string, receipt: RuntimeTransitionReceipt, desiredStates: Readonly<Record<string, string>>): Promise<void>;
  markCompensating?(transitionId: string, failure: string): Promise<void>;
  markRolledBack?(transitionId: string, receipt: RuntimeTransitionReceipt): Promise<void>;
  markRollbackFailed?(transitionId: string, failure: string): Promise<void>;
}

export type RuntimeCapabilityCoordinatorDeps = {
  receipts: RuntimeCapabilityTransitionReceipts;
  isPromoterAvailable(image?: string): Promise<boolean>;
  runPromoter(params: PromoterParams): Promise<PromoterResult>;
  promoterParams: PromoterParams;
  protocolSecret?: string;
  protocolSecretFileHostPath?: string;
  resolveProjection?(keys: readonly string[]): Promise<{ catalogHash: string; stateHash: string; enabledKeys: string[]; composeProfiles: string[]; requiredServices: string[] }>;
  readHostReceipt?(transitionId: string): Promise<RuntimeTransitionReceipt>;
  verifyRequiredHealth?(desiredKeys: readonly string[], observedServices: readonly string[]): Promise<boolean>;
  now?: () => number;
};

type TransitionModel = {
  findFirst(args: unknown): Promise<{ transitionId: string; status: string } | null>;
  findUnique(args: unknown): Promise<{ status: string; catalogHash: string; previousStateHash: string; desiredStateHash: string; previousKeys: string[]; desiredKeys: string[] } | null>;
  create(args: unknown): Promise<unknown>;
  updateMany(args: unknown): Promise<{ count: number }>;
};
type CapabilityModel = { updateMany(args: unknown): Promise<{ count: number }> };
type TransitionTx = { $queryRaw(strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown>; runtimeCapabilityTransition: TransitionModel; platformCapability: CapabilityModel };
type TransitionPrisma = {
  runtimeCapabilityTransition: TransitionModel;
  $transaction<T>(operation: (tx: TransitionTx) => Promise<T>, options: { isolationLevel: "Serializable" }): Promise<T>;
};

export function createPrismaRuntimeTransitionReceipts(prisma: TransitionPrisma): RuntimeCapabilityTransitionReceipts {
  return {
    createPending: (input) => prisma.$transaction(async (tx) => {
      // Fixed SQL with no interpolation: the transaction-scoped lock serializes
      // the read/create pair before the partial unique index supplies backstop.
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('runtime-capability-transition'))`;
      const replay = await tx.runtimeCapabilityTransition.findUnique({ where: { transitionId: input.transitionId }, select: { status: true, catalogHash: true, previousStateHash: true, desiredStateHash: true, previousKeys: true, desiredKeys: true } });
      if (replay) {
        const same = replay.catalogHash === input.catalogHash && replay.previousStateHash === input.previousStateHash && replay.desiredStateHash === input.desiredStateHash && JSON.stringify(replay.previousKeys) === JSON.stringify([...input.previousKeys].sort()) && JSON.stringify(replay.desiredKeys) === JSON.stringify([...input.desiredKeys].sort());
        if (!same) throw new Error("transition_id_conflict");
        return { created: false, kind: "replay", status: replay.status };
      }
      const active = await tx.runtimeCapabilityTransition.findFirst({ where: { status: { in: [...ACTIVE_RUNTIME_TRANSITION_STATUSES] } }, select: { transitionId: true, status: true } });
      if (active) return { created: false, kind: "active_conflict", status: active.status, transitionId: active.transitionId };
      await tx.runtimeCapabilityTransition.create({ data: {
        transitionId: input.transitionId,
        previousKeys: [...input.previousKeys].sort(),
        desiredKeys: [...input.desiredKeys].sort(),
        previousProfiles: input.previousProfiles,
        desiredProfiles: input.desiredProfiles,
        previousStates: input.previousStates,
        desiredStates: input.desiredStates,
        previousStateHash: input.previousStateHash,
        desiredStateHash: input.desiredStateHash,
        catalogHash: input.catalogHash,
        status: "pending",
        requestedById: input.requestedById,
      } });
      return { created: true };
    }, { isolationLevel: "Serializable" }),
    markFailed: async (transitionId, failure) => { const r = await prisma.runtimeCapabilityTransition.updateMany({ where: { transitionId, status: { in: ["pending", "applying"] } }, data: { status: "failed", failure: { code: failure }, completedAt: new Date() } }); if (r.count !== 1) throw new Error("runtime_transition_cas_failed"); },
    markHostApplied: async (transitionId) => { const r = await prisma.runtimeCapabilityTransition.updateMany({ where: { transitionId, status: { in: ["pending", "applying"] } }, data: { status: "host_applied", hostAppliedAt: new Date() } }); if (r.count !== 1) throw new Error("runtime_transition_cas_failed"); },
    commitSuccess: (transitionId, receipt, desiredStates) => prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('runtime-capability-transition'))`;
      for (const [capabilityId, state] of Object.entries(desiredStates)) {
        const updated = await tx.platformCapability.updateMany({ where: { capabilityId }, data: { state } });
        if (updated.count !== 1) throw new Error(`runtime_capability_missing:${capabilityId}`);
      }
      const completed = await tx.runtimeCapabilityTransition.updateMany({ where: { transitionId, status: "host_applied" }, data: { status: "succeeded", hostReceipt: receipt, completedAt: new Date() } });
      if (completed.count !== 1) throw new Error("runtime_transition_cas_failed");
    }, { isolationLevel: "Serializable" }),
    markCompensating: async (transitionId, failure) => { const r = await prisma.runtimeCapabilityTransition.updateMany({ where: { transitionId, status: "host_applied" }, data: { status: "compensating", failure: { code: failure } } }); if (r.count !== 1) throw new Error("runtime_transition_cas_failed"); },
    markRolledBack: async (transitionId, receipt) => { const r = await prisma.runtimeCapabilityTransition.updateMany({ where: { transitionId, status: "compensating" }, data: { status: "rolled_back", hostReceipt: receipt, completedAt: new Date() } }); if (r.count !== 1) throw new Error("runtime_transition_cas_failed"); },
    markRollbackFailed: async (transitionId, failure) => { const r = await prisma.runtimeCapabilityTransition.updateMany({ where: { transitionId, status: "compensating" }, data: { status: "rollback_failed", failure: { code: failure }, completedAt: new Date() } }); if (r.count !== 1) throw new Error("runtime_transition_cas_failed"); },
  };
}

export type RuntimeTransitionReconcileRow = {
  transitionId: string; status: string; catalogHash: string; previousStateHash: string; desiredStateHash: string;
  previousKeys: string[]; desiredKeys: string[]; previousProfiles: string[]; desiredProfiles: string[];
};

/** Startup recovery runs before mutation is enabled and converges every nonterminal row. */
export async function reconcileRuntimeCapabilityTransitions(deps: {
  listActive(): Promise<RuntimeTransitionReconcileRow[]>;
  readHostReceipt(transitionId: string): Promise<RuntimeTransitionReceipt | null>;
  completeFromReceipt(row: RuntimeTransitionReconcileRow, receipt: RuntimeTransitionReceipt): Promise<void>;
  compensate(row: RuntimeTransitionReconcileRow, reason: string): Promise<void>;
  protocolSecret: string;
  now?: () => number;
}): Promise<void> {
  for (const row of await deps.listActive()) {
    const receipt = await deps.readHostReceipt(row.transitionId);
    if (!receipt) { await deps.compensate(row, "host_receipt_absent"); continue; }
    const envelope: RuntimeTransitionEnvelope = { version: 1, transitionId: row.transitionId, issuedAt: receipt.issuedAt, expiresAt: receipt.expiresAt, catalogHash: row.catalogHash, previousStateHash: row.previousStateHash, desiredStateHash: row.desiredStateHash, previousKeys: row.previousKeys, desiredKeys: row.desiredKeys, previousProfiles: row.previousProfiles, desiredProfiles: row.desiredProfiles };
    try {
      verifyTransitionReceipt(receipt, deps.protocolSecret, envelope, deps.now?.() ?? Date.now());
      await deps.completeFromReceipt(row, receipt);
    } catch (error) {
      await deps.compensate(row, error instanceof Error ? error.message : "invalid_host_receipt");
    }
  }
}

function validateRequest(request: RuntimeCapabilityTransitionRequest): void {
  if (!/^RCT-[A-Za-z0-9-]{1,48}$/.test(request.transitionId)) throw new Error("invalid_transition_id");
  if (!/^[a-f0-9]{64}$/.test(request.catalogHash)) throw new Error("invalid_catalog_hash");
  for (const [label, keys, states] of [["previous", request.previousKeys, request.previousStates], ["desired", request.desiredKeys, request.desiredStates]] as const) {
    if (new Set(keys).size !== keys.length || JSON.stringify(keys) !== JSON.stringify([...keys].sort())) throw new Error(`invalid_${label}_keys`);
    if (keys.some((key) => !/^runtime:[a-z0-9-]+$/.test(key))) throw new Error(`invalid_${label}_keys`);
    if (Object.values(states).some((state) => state !== "active" && state !== "disabled")) throw new Error(`invalid_${label}_state`);
    const activeKeys = Object.entries(states).filter(([, state]) => state === "active").map(([key]) => key).sort();
    if (JSON.stringify(activeKeys) !== JSON.stringify(keys)) throw new Error(`invalid_${label}_state_map`);
    if (Object.keys(states).some((key) => !/^runtime:[a-z0-9-]+$/.test(key))) throw new Error(`invalid_${label}_state_map`);
  }
}

/**
 * Portal-core half of the saga. The promoter currently fails closed before host
 * apply; reaching host_applied requires Step 7 signed receipt verification.
 */
export async function coordinateRuntimeCapabilityTransition(
  request: RuntimeCapabilityTransitionRequest,
  deps: RuntimeCapabilityCoordinatorDeps,
) {
  validateRequest(request);
  const normalized = {
    ...request,
    previousKeys: [...request.previousKeys].sort(),
    desiredKeys: [...request.desiredKeys].sort(),
    previousStateHash: computeCapabilityStateVersion(request.catalogHash, request.previousStates),
    desiredStateHash: computeCapabilityStateVersion(request.catalogHash, request.desiredStates),
  };
  if (!request.requestedById) throw new Error("requested_by_required");
  let available = false;
  try { available = await deps.isPromoterAvailable(deps.promoterParams.promoterImage); } catch { available = false; }
  if (!available) {
    return { status: "failed" as const, failure: "promoter_unavailable" as const };
  }
  let result: PromoterResult;
  if (!deps.protocolSecret || deps.protocolSecret.length < 32 || !deps.protocolSecretFileHostPath || !deps.resolveProjection || !deps.promoterParams.stateDirHostPath || !deps.readHostReceipt || !deps.verifyRequiredHealth || !deps.promoterParams.composeProject || !deps.promoterParams.composeFiles?.length) {
    return { status: "failed" as const, failure: "signed_protocol_unavailable" as const };
  }
  const now = deps.now?.() ?? Date.now();
  let previousProjection, desiredProjection;
  try {
    previousProjection = await deps.resolveProjection(normalized.previousKeys);
    desiredProjection = await deps.resolveProjection(normalized.desiredKeys);
  } catch {
    return { status: "failed" as const, failure: "capability_projection_unavailable" as const };
  }
  if (previousProjection.catalogHash !== request.catalogHash || desiredProjection.catalogHash !== request.catalogHash ||
      previousProjection.stateHash !== normalized.previousStateHash || desiredProjection.stateHash !== normalized.desiredStateHash ||
      JSON.stringify(previousProjection.enabledKeys) !== JSON.stringify(normalized.previousKeys) || JSON.stringify(desiredProjection.enabledKeys) !== JSON.stringify(normalized.desiredKeys)) {
    return { status: "failed" as const, failure: "capability_projection_mismatch" as const };
  }
  const pending = await deps.receipts.createPending({ ...normalized, previousProfiles: previousProjection.composeProfiles, desiredProfiles: desiredProjection.composeProfiles });
  if (!pending.created) {
    if (pending.kind === "active_conflict" || ACTIVE_RUNTIME_TRANSITION_STATUSES.includes(pending.status as never)) return { status: "transition_in_progress" as const };
    return { status: "already_terminal" as const, transitionStatus: pending.status };
  }
  const envelope: RuntimeTransitionEnvelope = {
    version: 1, transitionId: request.transitionId, issuedAt: new Date(now).toISOString(), expiresAt: new Date(now + 10 * 60 * 1000).toISOString(),
    catalogHash: request.catalogHash, previousStateHash: normalized.previousStateHash, desiredStateHash: normalized.desiredStateHash,
    previousKeys: normalized.previousKeys, desiredKeys: normalized.desiredKeys,
    previousProfiles: previousProjection.composeProfiles, desiredProfiles: desiredProjection.composeProfiles,
  };
  const encodedEnvelope = Buffer.from(JSON.stringify(envelope)).toString("base64url");
  try { result = await deps.runPromoter({
    ...deps.promoterParams,
    runtimeCapabilityTransitionId: request.transitionId,
    containerName: `dpf-promoter-${request.transitionId}`,
    timeoutMs: 10 * 60 * 1000,
    runtimeCapabilityEnvelope: encodedEnvelope,
    runtimeCapabilitySignature: signTransitionPayload(envelope, deps.protocolSecret),
    runtimeCapabilitySecretFileHostPath: deps.protocolSecretFileHostPath,
  }); } catch { await deps.receipts.markFailed(request.transitionId, "promoter_spawn_failed"); return { status: "failed" as const, failure: "promoter_spawn_failed" as const }; }
  if (result.exitCode !== 0) {
    await deps.receipts.markFailed(request.transitionId, "host_apply_failed");
    return { status: "failed" as const, failure: "host_apply_failed" as const };
  }
  await deps.receipts.markHostApplied(request.transitionId);
  try {
    const receipt = await deps.readHostReceipt(request.transitionId);
    verifyTransitionReceipt(receipt, deps.protocolSecret, envelope, deps.now?.() ?? Date.now());
    if (!(await deps.verifyRequiredHealth(desiredProjection.requiredServices, receipt.observedServices))) throw new Error("required_health_failed");
    if (!deps.receipts.commitSuccess) return { status: "host_applied_pending_verification" as const };
    await deps.receipts.commitSuccess(request.transitionId, receipt, request.desiredStates);
    return { status: "succeeded" as const };
  } catch (error) {
    if (!deps.receipts.markCompensating || !deps.receipts.markRolledBack || !deps.receipts.markRollbackFailed) return { status: "host_applied_pending_verification" as const };
    const failure = error instanceof Error ? error.message : "post_host_verification_failed";
    await deps.receipts.markCompensating(request.transitionId, failure);
    const rollbackNow = deps.now?.() ?? Date.now();
    const rollbackTransitionId = `RCT-${createHash("sha256").update(request.transitionId).digest("hex").slice(0, 24)}-rb`;
    const rollbackEnvelope: RuntimeTransitionEnvelope = { ...envelope, transitionId: rollbackTransitionId, issuedAt: new Date(rollbackNow).toISOString(), expiresAt: new Date(rollbackNow + 600_000).toISOString(), previousKeys: normalized.desiredKeys, desiredKeys: normalized.previousKeys, previousProfiles: desiredProjection.composeProfiles, desiredProfiles: previousProjection.composeProfiles, previousStateHash: normalized.desiredStateHash, desiredStateHash: normalized.previousStateHash };
    try {
      const rollback = await deps.runPromoter({ ...deps.promoterParams, runtimeCapabilityTransitionId: rollbackTransitionId, containerName: `dpf-promoter-${rollbackTransitionId}`, timeoutMs: 600_000, runtimeCapabilityEnvelope: Buffer.from(JSON.stringify(rollbackEnvelope)).toString("base64url"), runtimeCapabilitySignature: signTransitionPayload(rollbackEnvelope, deps.protocolSecret), runtimeCapabilitySecretFileHostPath: deps.protocolSecretFileHostPath });
      if (rollback.exitCode !== 0) throw new Error("rollback_host_apply_failed");
      const receipt = await deps.readHostReceipt(rollbackTransitionId);
      verifyTransitionReceipt(receipt, deps.protocolSecret, rollbackEnvelope, deps.now?.() ?? Date.now());
      await deps.receipts.markRolledBack(request.transitionId, receipt);
      return { status: "rolled_back" as const, failure };
    } catch (rollbackError) {
      await deps.receipts.markRollbackFailed(request.transitionId, rollbackError instanceof Error ? rollbackError.message : "rollback_failed");
      return { status: "rollback_failed" as const, failure };
    }
  }
}
