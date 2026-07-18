/**
 * Provider health loader (routing-resilience spec §4.3, Slice C).
 *
 * Thin, READ-ONLY wrapper that gathers the live signals deriveProviderHealth()
 * needs from the database and returns the operator-facing health for a provider.
 * Kept separate from the pure projection so the projection stays unit-testable
 * without a DB, and so this loader can be mocked in turn.
 *
 * The runtime-circuit signal (rate-tracker.getEndpointRuntimeState, Slice A) is
 * injected via `opts.runtimeState` rather than imported, so this module is
 * independent of Slice A's merge order. The provider-health UI passes the real
 * lookup once both land.
 */

import { Prisma, prisma } from "@dpf/db";
import {
  deriveProviderHealth,
  type ProviderHealth,
  type RecentOutcome,
} from "./provider-health";

/** Lookup for the runtime circuit state of a single endpoint (provider+model). */
export type RuntimeStateLookup = (
  providerId: string,
  modelId: string,
) => { unavailable: boolean; reason?: string; until?: number };

export interface LoadProviderHealthOptions {
  /** Epoch ms; defaults to now. Injected for deterministic tests. */
  now?: number;
  /** How many recent RouteOutcome rows to consider. Default 20. */
  recentLimit?: number;
  /** Optional runtime-circuit lookup (Slice A). Omitted → DB-only health. */
  runtimeState?: RuntimeStateLookup;
}

export type ProviderHealthBatchEntry =
  | { status: "fulfilled"; value: ProviderHealth }
  | { status: "rejected"; configured: boolean };

type ProviderHealthBatchOutcome = {
  providerId: string;
  providerErrorCode: string | null;
  fallbackOccurred: boolean;
  createdAt: Date;
  latencyMs: number;
  modelId: string;
};

/**
 * Batch provider reconciliation for operator surfaces. The three shared reads
 * stay constant as the provider catalog grows, while a failure in one pure
 * reconciliation is represented only on that provider.
 */
export async function loadProviderHealthBatch(
  providerIds: string[],
  opts: LoadProviderHealthOptions = {},
): Promise<Map<string, ProviderHealthBatchEntry>> {
  const uniqueIds = [...new Set(providerIds)];
  if (uniqueIds.length === 0) return new Map();
  const now = opts.now ?? Date.now();
  const recentLimit = opts.recentLimit ?? 20;

  const [providers, outcomes, capacityRows] = await Promise.all([
    prisma.modelProvider.findMany({
      where: { providerId: { in: uniqueIds }, retiredAt: null },
      select: { providerId: true, status: true, authMethod: true },
    }),
    prisma.$queryRaw<ProviderHealthBatchOutcome[]>`
      WITH ranked AS (
        SELECT
          "providerId",
          "providerErrorCode",
          "fallbackOccurred",
          "createdAt",
          "latencyMs",
          "modelId",
          ROW_NUMBER() OVER (PARTITION BY "providerId" ORDER BY "createdAt" DESC) AS rn
        FROM "RouteOutcome"
        WHERE "providerId" IN (${Prisma.join(uniqueIds)})
      )
      SELECT
        "providerId",
        "providerErrorCode",
        "fallbackOccurred",
        "createdAt",
        "latencyMs",
        "modelId"
      FROM ranked
      WHERE rn <= ${recentLimit}
      ORDER BY "providerId", "createdAt" DESC
    `,
    prisma.providerCapacityStatus.findMany({
      where: { providerId: { in: uniqueIds } },
      select: {
        providerId: true,
        state: true,
        action: true,
        retryAt: true,
        safeSummary: true,
        isHumanActionRequired: true,
      },
    }),
  ]);

  const providersById = new Map(providers.map((provider) => [provider.providerId, provider]));
  const capacityById = new Map(capacityRows.map((capacity) => [capacity.providerId, capacity]));
  const outcomesById = new Map<string, ProviderHealthBatchOutcome[]>();
  for (const outcome of outcomes) {
    const bucket = outcomesById.get(outcome.providerId) ?? [];
    bucket.push(outcome);
    outcomesById.set(outcome.providerId, bucket);
  }

  const result = new Map<string, ProviderHealthBatchEntry>();
  for (const providerId of uniqueIds) {
    try {
      const provider = providersById.get(providerId);
      const providerOutcomes = outcomesById.get(providerId) ?? [];
      const representativeModelId = providerOutcomes[0]?.modelId;
      const runtimeCooldown = opts.runtimeState && representativeModelId
        ? opts.runtimeState(providerId, representativeModelId)
        : undefined;
      const value = deriveProviderHealth({
        providerId,
        lifecycleStatus: provider?.status ?? "unconfigured",
        authMethod: provider?.authMethod,
        recentOutcomes: providerOutcomes.map((outcome) => ({
          providerErrorCode: outcome.providerErrorCode,
          fallbackOccurred: outcome.fallbackOccurred,
          createdAt: outcome.createdAt,
          latencyMs: outcome.latencyMs,
        })),
        capacityStatus: capacityById.get(providerId),
        ...(runtimeCooldown ? { runtimeCooldown } : {}),
        now,
      });
      result.set(providerId, { status: "fulfilled", value });
    } catch {
      const lifecycle = providersById.get(providerId)?.status;
      result.set(providerId, {
        status: "rejected",
        configured: lifecycle !== undefined && lifecycle !== "unconfigured" && lifecycle !== "inactive",
      });
    }
  }
  return result;
}

export async function loadProviderHealth(
  providerId: string,
  opts: LoadProviderHealthOptions = {},
): Promise<ProviderHealth> {
  const now = opts.now ?? Date.now();

  const [provider, outcomes, capacityStatus] = await Promise.all([
    prisma.modelProvider.findUnique({
      where: { providerId },
      select: { status: true, authMethod: true },
    }),
    prisma.routeOutcome.findMany({
      where: { providerId },
      orderBy: { createdAt: "desc" },
      take: opts.recentLimit ?? 20,
      select: {
        providerErrorCode: true,
        fallbackOccurred: true,
        createdAt: true,
        latencyMs: true,
        modelId: true,
      },
    }),
    prisma.providerCapacityStatus.findUnique({
      where: { providerId },
      select: {
        state: true,
        action: true,
        retryAt: true,
        safeSummary: true,
        isHumanActionRequired: true,
      },
    }),
  ]);

  if (!provider) {
    return deriveProviderHealth({
      providerId,
      lifecycleStatus: "unconfigured",
      recentOutcomes: [],
      now,
    });
  }

  // The runtime circuit is keyed per provider+model. Use the most-recent model
  // seen in telemetry as the representative endpoint for the provider-level
  // badge (the badge is provider-scoped; per-model detail is a deeper view).
  let runtimeCooldown: ReturnType<RuntimeStateLookup> | undefined;
  const representativeModelId = outcomes[0]?.modelId;
  if (opts.runtimeState && representativeModelId) {
    runtimeCooldown = opts.runtimeState(providerId, representativeModelId);
  }

  const recentOutcomes: RecentOutcome[] = outcomes.map((o) => ({
    providerErrorCode: o.providerErrorCode,
    fallbackOccurred: o.fallbackOccurred,
    createdAt: o.createdAt,
    latencyMs: o.latencyMs,
  }));

  return deriveProviderHealth({
    providerId,
    lifecycleStatus: provider.status,
    authMethod: provider.authMethod,
    recentOutcomes,
    capacityStatus,
    ...(runtimeCooldown ? { runtimeCooldown } : {}),
    now,
  });
}
