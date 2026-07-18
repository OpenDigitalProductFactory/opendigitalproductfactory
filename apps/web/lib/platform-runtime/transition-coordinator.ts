import { createHash } from "node:crypto";
import type { PromoterParams, PromoterResult } from "@/lib/self-upgrade/promoter";

export const ACTIVE_RUNTIME_TRANSITION_STATUSES = ["pending", "applying", "host_applied", "compensating"] as const;

export function computeCapabilityStateVersion(catalogHash: string, states: Readonly<Record<string, string>>): string {
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
  createPending(input: RuntimeCapabilityTransitionRequest & { previousStateHash: string; desiredStateHash: string }): Promise<{ created: boolean }>;
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
  findFirst(args: unknown): Promise<unknown>;
  create(args: unknown): Promise<unknown>;
  update(args: unknown): Promise<unknown>;
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
      const active = await tx.runtimeCapabilityTransition.findFirst({ where: { status: { in: [...ACTIVE_RUNTIME_TRANSITION_STATUSES] } }, select: { id: true } });
      if (active) return { created: false };
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
    markFailed: async (transitionId, failure) => { await prisma.runtimeCapabilityTransition.update({ where: { transitionId }, data: { status: "failed", failure: { code: failure }, completedAt: new Date() } }); },
    markHostApplied: async (transitionId) => { await prisma.runtimeCapabilityTransition.update({ where: { transitionId }, data: { status: "host_applied", hostAppliedAt: new Date() } }); },
  };
}

/**
 * Portal-core half of the saga. This deliberately stops at host_applied: signed
 * receipt verification, health validation, DB commit, and compensation belong
 * to Steps 7-9 and no action/API calls this coordinator before they exist.
 */
export async function coordinateRuntimeCapabilityTransition(
  request: RuntimeCapabilityTransitionRequest,
  deps: RuntimeCapabilityCoordinatorDeps,
) {
  const normalized = {
    ...request,
    previousKeys: [...request.previousKeys].sort(),
    desiredKeys: [...request.desiredKeys].sort(),
    previousStateHash: computeCapabilityStateVersion(request.catalogHash, request.previousStates),
    desiredStateHash: computeCapabilityStateVersion(request.catalogHash, request.desiredStates),
  };
  const pending = await deps.receipts.createPending(normalized);
  if (!pending.created) return { status: "transition_in_progress" as const };
  if (!await deps.isPromoterAvailable(deps.promoterParams.promoterImage)) {
    await deps.receipts.markFailed(request.transitionId, "promoter_unavailable");
    return { status: "failed" as const, failure: "promoter_unavailable" as const };
  }
  const result = await deps.runPromoter({
    ...deps.promoterParams,
    runtimeCapabilityTransitionId: request.transitionId,
    containerName: `dpf-promoter-${request.transitionId}`,
    timeoutMs: 10 * 60 * 1000,
  });
  if (result.exitCode !== 0) {
    await deps.receipts.markFailed(request.transitionId, "host_apply_failed");
    return { status: "failed" as const, failure: "host_apply_failed" as const };
  }
  await deps.receipts.markHostApplied(request.transitionId);
  return { status: "host_applied_pending_verification" as const };
}
