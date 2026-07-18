import { prisma } from "@dpf/db";

import {
  loadOperationalCapabilityState,
  type OperationalCapabilityState,
  type ObservedProviderState,
} from "./operational-state";
import {
  projectCapabilityServiceHealth,
  type CapabilityServiceHealthProjection,
} from "./service-health";

type ProviderObservationRow = { providerId: string; status: string };

type LoaderDependencies = {
  loadOperationalState?: () => Promise<OperationalCapabilityState>;
  readProviders?: () => Promise<ProviderObservationRow[]>;
};

/**
 * Server-side loader for the shared operator projection. Provider rows are
 * observations only: the generated catalog remains the authority for which
 * external runtime keys may appear.
 */
export async function loadCapabilityServiceHealth(
  dependencies: LoaderDependencies = {},
): Promise<CapabilityServiceHealthProjection> {
  const loadOperationalState = dependencies.loadOperationalState ?? (() =>
    loadOperationalCapabilityState({ observedProviders: {} }));
  const readProviders = dependencies.readProviders ?? (() =>
    prisma.modelProvider.findMany({
      where: { retiredAt: null },
      select: { providerId: true, status: true },
    }));

  const [operational, providers] = await Promise.all([
    loadOperationalState(),
    readProviders(),
  ]);
  const allowedRuntimeKeys = new Set(
    operational.externalRuntimes.map((runtime) => runtime.runtimeKey),
  );
  const providerState: Record<string, ObservedProviderState> = {};
  for (const provider of providers) {
    if (!allowedRuntimeKeys.has(provider.providerId)) continue;
    if (provider.status !== "active") continue;
    providerState[provider.providerId] = { configured: true, healthy: null };
  }

  return projectCapabilityServiceHealth({ ...operational, providerState });
}
