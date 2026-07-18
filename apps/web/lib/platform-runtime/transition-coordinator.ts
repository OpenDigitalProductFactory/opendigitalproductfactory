import { createHash } from "node:crypto";
import type { PromoterParams, PromoterResult } from "@/lib/self-upgrade/promoter";

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
};

export interface RuntimeCapabilityTransitionReceipts {
  /** Implementations serialize with an advisory lock + the DB partial unique index. */
  createPending(input: RuntimeCapabilityTransitionRequest & { previousStateHash: string; desiredStateHash: string }): Promise<
    | { created: true }
    | { created: false; kind: "replay"; status: string }
    | { created: false; kind: "active_conflict"; status: string; transitionId: string }
  >;
  markFailed(transitionId: string, failure: string): Promise<void>;
  markHostApplied(transitionId: string): Promise<void>;
}

export type RuntimeCapabilityCoordinatorDeps = {
  receipts: RuntimeCapabilityTransitionReceipts;
  isPromoterAvailable(image?: string): Promise<boolean>;
  runPromoter(params: PromoterParams): Promise<PromoterResult>;
  promoterParams: PromoterParams;
};

type TransitionModel = {
  findFirst(args: unknown): Promise<{ transitionId: string; status: string } | null>;
  findUnique(args: unknown): Promise<{ status: string; catalogHash: string; previousStateHash: string; desiredStateHash: string; previousKeys: string[]; desiredKeys: string[] } | null>;
  create(args: unknown): Promise<unknown>;
  updateMany(args: unknown): Promise<{ count: number }>;
};
type TransitionTx = { $queryRaw(strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown>; runtimeCapabilityTransition: TransitionModel };
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
        previousStateHash: input.previousStateHash,
        desiredStateHash: input.desiredStateHash,
        catalogHash: input.catalogHash,
        status: "pending",
      } });
      return { created: true };
    }, { isolationLevel: "Serializable" }),
    markFailed: async (transitionId, failure) => { const r = await prisma.runtimeCapabilityTransition.updateMany({ where: { transitionId, status: { in: ["pending", "applying"] } }, data: { status: "failed", failure: { code: failure }, completedAt: new Date() } }); if (r.count !== 1) throw new Error("runtime_transition_cas_failed"); },
    markHostApplied: async (transitionId) => { const r = await prisma.runtimeCapabilityTransition.updateMany({ where: { transitionId, status: { in: ["pending", "applying"] } }, data: { status: "host_applied", hostAppliedAt: new Date() } }); if (r.count !== 1) throw new Error("runtime_transition_cas_failed"); },
  };
}

function validateRequest(request: RuntimeCapabilityTransitionRequest): void {
  if (!/^RCT-[A-Za-z0-9-]{1,48}$/.test(request.transitionId)) throw new Error("invalid_transition_id");
  if (!/^[a-f0-9]{64}$/.test(request.catalogHash)) throw new Error("invalid_catalog_hash");
  for (const [label, keys, states] of [["previous", request.previousKeys, request.previousStates], ["desired", request.desiredKeys, request.desiredStates]] as const) {
    if (new Set(keys).size !== keys.length || JSON.stringify(keys) !== JSON.stringify([...keys].sort())) throw new Error(`invalid_${label}_keys`);
    if (keys.some((key) => !/^runtime:[a-z0-9-]+$/.test(key))) throw new Error(`invalid_${label}_keys`);
    if (JSON.stringify(Object.keys(states).sort()) !== JSON.stringify(keys)) throw new Error(`invalid_${label}_state_map`);
    if (Object.values(states).some((state) => state !== "active" && state !== "disabled")) throw new Error(`invalid_${label}_state`);
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
  const pending = await deps.receipts.createPending(normalized);
  if (!pending.created) {
    if (pending.kind === "active_conflict" || ACTIVE_RUNTIME_TRANSITION_STATUSES.includes(pending.status as never)) return { status: "transition_in_progress" as const };
    return { status: "already_terminal" as const, transitionStatus: pending.status };
  }
  let available = false;
  try { available = await deps.isPromoterAvailable(deps.promoterParams.promoterImage); } catch { available = false; }
  if (!available) {
    await deps.receipts.markFailed(request.transitionId, "promoter_unavailable");
    return { status: "failed" as const, failure: "promoter_unavailable" as const };
  }
  let result: PromoterResult;
  try { result = await deps.runPromoter({
    ...deps.promoterParams,
    runtimeCapabilityTransitionId: request.transitionId,
    containerName: `dpf-promoter-${request.transitionId}`,
    timeoutMs: 10 * 60 * 1000,
  }); } catch { await deps.receipts.markFailed(request.transitionId, "promoter_spawn_failed"); return { status: "failed" as const, failure: "promoter_spawn_failed" as const }; }
  if (result.exitCode !== 0) {
    await deps.receipts.markFailed(request.transitionId, "host_apply_failed");
    return { status: "failed" as const, failure: "host_apply_failed" as const };
  }
  await deps.receipts.markHostApplied(request.transitionId);
  return { status: "host_applied_pending_verification" as const };
}
