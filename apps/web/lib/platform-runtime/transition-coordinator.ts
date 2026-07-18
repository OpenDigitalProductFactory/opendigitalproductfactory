import { createHash } from "node:crypto";
import type { PromoterParams, PromoterResult } from "@/lib/self-upgrade/promoter";
import { signTransitionPayload, type RuntimeTransitionEnvelope, type RuntimeTransitionReceipt, verifyHistoricalTransitionReceipt, verifyTransitionReceipt } from "./transition-protocol";

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
  createPending(input: RuntimeCapabilityTransitionRequest & { previousStateHash: string; desiredStateHash: string; previousProfiles: string[]; desiredProfiles: string[]; previousServices?: string[]; desiredServices?: string[]; envelope: RuntimeTransitionEnvelope; envelopeSignature: string; recheckAttributedWork?: () => Promise<Readonly<Record<string, number>>> }): Promise<
    | { created: true; envelope: RuntimeTransitionEnvelope; envelopeSignature: string }
    | { created: false; kind: "drain_required"; blockingCounts: Readonly<Record<string, number>> }
    | { created: false; kind: "replay"; status: string; envelope: RuntimeTransitionEnvelope; envelopeSignature: string }
    | { created: false; kind: "active_conflict"; status: string; transitionId: string }
  >;
  markFailed(transitionId: string, failure: string): Promise<void>;
  markHostOutcome?(transitionId: string, receipt: RuntimeTransitionReceipt): Promise<void>;
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
  recheckAttributedWork?(): Promise<Readonly<Record<string, number>>>;
  readHostReceipt?(transitionId: string): Promise<RuntimeTransitionReceipt>;
  verifyRequiredHealth?(desiredKeys: readonly string[], observedServices: readonly string[], observedHealth?: Readonly<Record<string, string>>): Promise<boolean>;
  now?: () => number;
};

type TransitionModel = {
  findFirst(args: unknown): Promise<{ transitionId: string; status: string } | null>;
  findUnique(args: unknown): Promise<{ status: string; catalogHash: string; previousStateHash: string; desiredStateHash: string; previousKeys: string[]; desiredKeys: string[]; previousProfiles: string[]; desiredProfiles: string[]; previousServices: string[]; desiredServices: string[]; envelope: RuntimeTransitionEnvelope | null; envelopeSignature: string | null } | null>;
  create(args: unknown): Promise<unknown>;
  updateMany(args: unknown): Promise<{ count: number }>;
};
type CapabilityModel = { updateMany(args: unknown): Promise<{ count: number }> };
type EventModel = { create(args: unknown): Promise<unknown> };
type TransitionTx = { $queryRaw(strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown>; runtimeCapabilityTransition: TransitionModel; platformCapability: CapabilityModel; runtimeCapabilityTransitionEvent: EventModel };
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
      const replay = await tx.runtimeCapabilityTransition.findUnique({ where: { transitionId: input.transitionId }, select: { status: true, catalogHash: true, previousStateHash: true, desiredStateHash: true, previousKeys: true, desiredKeys: true, previousProfiles: true, desiredProfiles: true, previousServices: true, desiredServices: true, envelope: true, envelopeSignature: true } });
      if (replay) {
        const same = replay.catalogHash === input.catalogHash && replay.previousStateHash === input.previousStateHash && replay.desiredStateHash === input.desiredStateHash && JSON.stringify(replay.previousKeys) === JSON.stringify([...input.previousKeys].sort()) && JSON.stringify(replay.desiredKeys) === JSON.stringify([...input.desiredKeys].sort()) && JSON.stringify(replay.previousProfiles) === JSON.stringify(input.previousProfiles) && JSON.stringify(replay.desiredProfiles) === JSON.stringify(input.desiredProfiles) && JSON.stringify(replay.previousServices) === JSON.stringify(input.previousServices ?? []) && JSON.stringify(replay.desiredServices) === JSON.stringify(input.desiredServices ?? []);
        if (!same) throw new Error("transition_id_conflict");
        if (!replay.envelope || !replay.envelopeSignature) throw new Error("transition_envelope_identity_missing");
        return { created: false, kind: "replay", status: replay.status, envelope: replay.envelope, envelopeSignature: replay.envelopeSignature };
      }
      const active = await tx.runtimeCapabilityTransition.findFirst({ where: { status: { in: [...ACTIVE_RUNTIME_TRANSITION_STATUSES] } }, select: { transitionId: true, status: true } });
      if (active) return { created: false, kind: "active_conflict", status: active.status, transitionId: active.transitionId };
      const blockingCounts = input.recheckAttributedWork ? await input.recheckAttributedWork() : {};
      const positive = Object.fromEntries(Object.entries(blockingCounts).filter(([, count]) => count > 0));
      if (Object.keys(positive).length) return { created: false, kind: "drain_required", blockingCounts: positive };
      await tx.runtimeCapabilityTransition.create({ data: {
        transitionId: input.transitionId,
        previousKeys: [...input.previousKeys].sort(),
        desiredKeys: [...input.desiredKeys].sort(),
        previousProfiles: input.previousProfiles,
        desiredProfiles: input.desiredProfiles,
        previousServices: input.previousServices ?? [],
        desiredServices: input.desiredServices ?? [],
        previousStates: input.previousStates,
        desiredStates: input.desiredStates,
        previousStateHash: input.previousStateHash,
        desiredStateHash: input.desiredStateHash,
        catalogHash: input.catalogHash,
        issuedAt: new Date(input.envelope.issuedAt),
        expiresAt: new Date(input.envelope.expiresAt),
        envelope: input.envelope,
        envelopeSignature: input.envelopeSignature,
        status: "pending",
        requestedById: input.requestedById,
      } });
      return { created: true, envelope: input.envelope, envelopeSignature: input.envelopeSignature };
    }, { isolationLevel: "Serializable" }),
    markFailed: (transitionId, failure) => prisma.$transaction(async (tx) => { const r = await tx.runtimeCapabilityTransition.updateMany({ where: { transitionId, status: { in: ["pending", "applying"] } }, data: { status: "failed", failure: { code: failure }, completedAt: new Date() } }); if (r.count !== 1) throw new Error("runtime_transition_cas_failed"); await tx.runtimeCapabilityTransitionEvent.create({ data: { transitionId, outcome: "failed", detail: { failure } } }); }, { isolationLevel: "Serializable" }),
    markHostOutcome: (transitionId, receipt) => prisma.$transaction(async (tx) => { const status = receipt.status === "rolled_back" ? "rolled_back" : receipt.status === "rollback_failed" ? "rollback_failed" : "failed"; const r = await tx.runtimeCapabilityTransition.updateMany({ where: { transitionId, status: { in: ["pending", "applying"] } }, data: { status, hostReceipt: receipt, failure: { code: receipt.failure ?? status }, completedAt: new Date() } }); if (r.count !== 1) throw new Error("runtime_transition_cas_failed"); await tx.runtimeCapabilityTransitionEvent.create({ data: { transitionId, outcome: status, detail: { receipt } } }); }, { isolationLevel: "Serializable" }),
    markHostApplied: async (transitionId) => { const r = await prisma.runtimeCapabilityTransition.updateMany({ where: { transitionId, status: { in: ["pending", "applying"] } }, data: { status: "host_applied", hostAppliedAt: new Date() } }); if (r.count !== 1) throw new Error("runtime_transition_cas_failed"); },
    commitSuccess: (transitionId, receipt, desiredStates) => prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('runtime-capability-transition'))`;
      for (const [capabilityId, state] of Object.entries(desiredStates)) {
        const updated = await tx.platformCapability.updateMany({ where: { capabilityId }, data: { state } });
        if (updated.count !== 1) throw new Error(`runtime_capability_missing:${capabilityId}`);
      }
      const completed = await tx.runtimeCapabilityTransition.updateMany({ where: { transitionId, status: "host_applied" }, data: { status: "succeeded", hostReceipt: receipt, completedAt: new Date() } });
      if (completed.count !== 1) throw new Error("runtime_transition_cas_failed");
      await tx.runtimeCapabilityTransitionEvent.create({ data: { transitionId, outcome: "succeeded", detail: { receipt } } });
    }, { isolationLevel: "Serializable" }),
    markCompensating: async (transitionId, failure) => { const r = await prisma.runtimeCapabilityTransition.updateMany({ where: { transitionId, status: "host_applied" }, data: { status: "compensating", failure: { code: failure } } }); if (r.count !== 1) throw new Error("runtime_transition_cas_failed"); },
    markRolledBack: async (transitionId, receipt) => { const r = await prisma.runtimeCapabilityTransition.updateMany({ where: { transitionId, status: "compensating" }, data: { status: "rolled_back", hostReceipt: receipt, completedAt: new Date() } }); if (r.count !== 1) throw new Error("runtime_transition_cas_failed"); },
    markRollbackFailed: async (transitionId, failure) => { const r = await prisma.runtimeCapabilityTransition.updateMany({ where: { transitionId, status: "compensating" }, data: { status: "rollback_failed", failure: { code: failure }, completedAt: new Date() } }); if (r.count !== 1) throw new Error("runtime_transition_cas_failed"); },
  };
}

export type RuntimeTransitionReconcileRow = {
  transitionId: string; status: string; catalogHash: string; previousStateHash: string; desiredStateHash: string;
  previousKeys: string[]; desiredKeys: string[]; previousProfiles: string[]; desiredProfiles: string[];
  previousServices: string[]; desiredServices: string[];
  previousStates: Readonly<Record<string, string>>; desiredStates: Readonly<Record<string, string>>; createdAt: Date;
  envelope: RuntimeTransitionEnvelope | null; envelopeSignature: string | null;
};

type InstallStateIdentity = { schemaVersion?: unknown; installerVersion?: unknown; platform?: unknown; arch?: unknown; enabledRuntimeCapabilities?: unknown; capabilityCatalogHash?: unknown; capabilityStateVersion?: unknown };
export function classifyRuntimeInstallState(value: InstallStateIdentity, row: RuntimeTransitionReconcileRow): "previous" | "desired" | "unknown" {
  if (!Number.isInteger(value.schemaVersion) || (value.schemaVersion as number) < 1 || typeof value.installerVersion !== "string" ||
      !["darwin", "linux", "win32"].includes(String(value.platform)) || !["arm64", "amd64", "x86_64"].includes(String(value.arch)) ||
      !Array.isArray(value.enabledRuntimeCapabilities) || value.enabledRuntimeCapabilities.some((key) => typeof key !== "string" || !/^runtime:[a-z0-9-]+$/.test(key)) ||
      JSON.stringify(value.enabledRuntimeCapabilities) !== JSON.stringify([...new Set(value.enabledRuntimeCapabilities)].sort()) ||
      value.capabilityCatalogHash !== row.catalogHash || typeof value.capabilityStateVersion !== "string") return "unknown";
  const keys = JSON.stringify(value.enabledRuntimeCapabilities);
  if (value.capabilityStateVersion === row.previousStateHash && keys === JSON.stringify(row.previousKeys)) return "previous";
  if (value.capabilityStateVersion === row.desiredStateHash && keys === JSON.stringify(row.desiredKeys)) return "desired";
  return "unknown";
}

/** Startup recovery runs before mutation is enabled and converges every nonterminal row. */
export async function reconcileRuntimeCapabilityTransitions(deps: {
  listActive(): Promise<RuntimeTransitionReconcileRow[]>;
  readHostReceipt(transitionId: string): Promise<RuntimeTransitionReceipt | null>;
  completeFromReceipt(row: RuntimeTransitionReconcileRow, receipt: RuntimeTransitionReceipt): Promise<void>;
  classifyTerminalReceipt(row: RuntimeTransitionReconcileRow, receipt: RuntimeTransitionReceipt): Promise<void>;
  relaunch(row: RuntimeTransitionReconcileRow): Promise<void>;
  markRecoveryRequired(row: RuntimeTransitionReconcileRow, reason: string): Promise<void>;
  compensate(row: RuntimeTransitionReconcileRow, reason: string): Promise<void>;
  /** Durable host journal distinguishes a clean previous state from an apply
   * that may have crossed the filesystem/Compose boundary before receipt. */
  inspectHostInstallState?(row: RuntimeTransitionReconcileRow): Promise<"previous" | "desired" | "unknown">;
  markCleanPrevious?(row: RuntimeTransitionReconcileRow, reason: string): Promise<void>;
  protocolSecret: string;
  now?: () => number;
}): Promise<void> {
  for (const row of await deps.listActive()) {
    if (!row.envelope || !row.envelopeSignature) {
      await deps.markRecoveryRequired(row, "transition_envelope_identity_missing");
      continue;
    }
    try {
      if (signTransitionPayload(row.envelope, deps.protocolSecret) !== row.envelopeSignature) {
        throw new Error("runtime_transition_envelope_tampered");
      }
    } catch (error) {
      await deps.markRecoveryRequired(row, error instanceof Error ? error.message : "invalid_transition_envelope");
      continue;
    }
    const receipt = await deps.readHostReceipt(row.transitionId);
    if (!receipt) {
      const now = deps.now?.() ?? Date.now();
      // Never mint a new host side effect from an expired authority envelope.
      // createdAt is deliberately not used: only the signed expiry is authority.
      if (Date.parse(row.envelope.expiresAt) >= now && Date.parse(row.envelope.issuedAt) <= now + 30_000) {
        await deps.relaunch(row);
      } else {
        if (deps.inspectHostInstallState) {
          const hostState = await deps.inspectHostInstallState(row);
          if (hostState === "previous" && deps.markCleanPrevious) {
            await deps.markCleanPrevious(row, "host_receipt_absent_or_expired_before_mutation");
            continue;
          }
          if (hostState === "unknown") {
            await deps.markRecoveryRequired(row, "runtime_transition_install_state_unknown");
            continue;
          }
        }
        try {
          await deps.compensate(row, "host_receipt_absent_or_expired");
        } catch (error) {
          await deps.markRecoveryRequired(row, error instanceof Error ? error.message : "runtime_transition_compensation_failed");
        }
      }
      continue;
    }
    try {
      const status = verifyHistoricalTransitionReceipt(receipt, deps.protocolSecret, row.envelope);
      if (status === "applied") await deps.completeFromReceipt(row, receipt);
      else await deps.classifyTerminalReceipt(row, receipt);
    } catch (error) {
      await deps.markRecoveryRequired(row, error instanceof Error ? error.message : "invalid_host_receipt");
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
  const proposedEnvelope: RuntimeTransitionEnvelope = {
    version: 1, transitionId: request.transitionId, issuedAt: new Date(now).toISOString(), expiresAt: new Date(now + 10 * 60 * 1000).toISOString(),
    catalogHash: request.catalogHash, previousStateHash: normalized.previousStateHash, desiredStateHash: normalized.desiredStateHash,
    previousKeys: normalized.previousKeys, desiredKeys: normalized.desiredKeys,
    previousProfiles: previousProjection.composeProfiles, desiredProfiles: desiredProjection.composeProfiles,
    previousServices: previousProjection.requiredServices, desiredServices: desiredProjection.requiredServices,
  };
  const proposedSignature = signTransitionPayload(proposedEnvelope, deps.protocolSecret);
  const pending = await deps.receipts.createPending({ ...normalized, previousProfiles: previousProjection.composeProfiles, desiredProfiles: desiredProjection.composeProfiles, previousServices: previousProjection.requiredServices, desiredServices: desiredProjection.requiredServices, envelope: proposedEnvelope, envelopeSignature: proposedSignature, recheckAttributedWork: deps.recheckAttributedWork });
  if (!pending.created) {
    if (pending.kind === "drain_required") return { status: "drain_required" as const, blockingCounts: pending.blockingCounts };
    if (pending.kind === "active_conflict") return { status: "transition_in_progress" as const };
    // An identical pending/applying receipt is a crash-recovery replay, not a
    // competing transition. The host claim/receipt protocol makes relaunch safe.
    if (pending.status === "pending" || pending.status === "applying") {
      // continue with the exact persisted immutable envelope
    } else if (ACTIVE_RUNTIME_TRANSITION_STATUSES.includes(pending.status as never)) return { status: "transition_in_progress" as const };
    else return { status: "already_terminal" as const, transitionStatus: pending.status };
  }
  let available = false;
  try { available = await deps.isPromoterAvailable(deps.promoterParams.promoterImage); } catch { available = false; }
  if (!available) {
    await deps.receipts.markFailed(request.transitionId, "promoter_unavailable");
    return { status: "failed" as const, failure: "promoter_unavailable" as const };
  }
  const envelope = pending.envelope;
  const envelopeSignature = pending.envelopeSignature;
  const encodedEnvelope = Buffer.from(JSON.stringify(envelope)).toString("base64url");
  try { result = await deps.runPromoter({
    ...deps.promoterParams,
    runtimeCapabilityTransitionId: request.transitionId,
    containerName: `dpf-promoter-${request.transitionId}`,
    timeoutMs: 10 * 60 * 1000,
    runtimeCapabilityEnvelope: encodedEnvelope,
    runtimeCapabilitySignature: envelopeSignature,
    runtimeCapabilitySecretFileHostPath: deps.protocolSecretFileHostPath,
  }); } catch { await deps.receipts.markFailed(request.transitionId, "promoter_spawn_failed"); return { status: "failed" as const, failure: "promoter_spawn_failed" as const }; }
  // EX_TEMPFAIL means another host process owns the immutable same-ID claim.
  // It is not a saga outcome: leave the durable row untouched for that owner or
  // startup reconciliation to complete.
  if (result.exitCode === 75) return { status: "transition_in_progress" as const };
  try {
    const receipt = await deps.readHostReceipt(request.transitionId);
    const receiptStatus = verifyTransitionReceipt(receipt, deps.protocolSecret, envelope, deps.now?.() ?? Date.now());
    if (result.exitCode !== 0 || receiptStatus !== "applied") {
      if (!deps.receipts.markHostOutcome) throw new Error("host_apply_failed");
      await deps.receipts.markHostOutcome(request.transitionId, receipt);
      return { status: receiptStatus === "rollback_failed" ? "rollback_failed" as const : receiptStatus === "rolled_back" ? "rolled_back" as const : "failed" as const, failure: receipt.failure ?? "host_apply_failed" };
    }
    await deps.receipts.markHostApplied(request.transitionId);
    if (!(await deps.verifyRequiredHealth(desiredProjection.requiredServices, receipt.observedServices, receipt.observedHealth))) throw new Error("required_health_failed");
    if (!deps.receipts.commitSuccess) return { status: "host_applied_pending_verification" as const };
    await deps.receipts.commitSuccess(request.transitionId, receipt, request.desiredStates);
    return { status: "succeeded" as const };
  } catch (error) {
    if (!deps.receipts.markCompensating || !deps.receipts.markRolledBack || !deps.receipts.markRollbackFailed) return { status: "host_applied_pending_verification" as const };
    const failure = error instanceof Error ? error.message : "post_host_verification_failed";
    if (result.exitCode !== 0) {
      await deps.receipts.markFailed(request.transitionId, failure);
      return { status: "failed" as const, failure: "host_apply_failed" as const };
    }
    await deps.receipts.markCompensating(request.transitionId, failure);
    const rollbackNow = deps.now?.() ?? Date.now();
    const rollbackTransitionId = `RCT-${createHash("sha256").update(request.transitionId).digest("hex").slice(0, 24)}-rb`;
    const rollbackEnvelope: RuntimeTransitionEnvelope = { ...envelope, transitionId: rollbackTransitionId, issuedAt: new Date(rollbackNow).toISOString(), expiresAt: new Date(rollbackNow + 600_000).toISOString(), previousKeys: normalized.desiredKeys, desiredKeys: normalized.previousKeys, previousProfiles: desiredProjection.composeProfiles, desiredProfiles: previousProjection.composeProfiles, previousServices: desiredProjection.requiredServices, desiredServices: previousProjection.requiredServices, previousStateHash: normalized.desiredStateHash, desiredStateHash: normalized.previousStateHash };
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
