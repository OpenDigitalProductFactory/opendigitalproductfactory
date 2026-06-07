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

import { prisma } from "@dpf/db";
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

export async function loadProviderHealth(
  providerId: string,
  opts: LoadProviderHealthOptions = {},
): Promise<ProviderHealth> {
  const now = opts.now ?? Date.now();

  const [provider, outcomes] = await Promise.all([
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
    ...(runtimeCooldown ? { runtimeCooldown } : {}),
    now,
  });
}
