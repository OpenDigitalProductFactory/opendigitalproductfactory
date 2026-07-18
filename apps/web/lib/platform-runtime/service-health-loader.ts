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
import { loadProviderHealth } from "@/lib/routing/provider-health-loader";
import type { ProviderHealth } from "@/lib/routing/provider-health";
import { getEndpointRuntimeState } from "@/lib/routing/rate-tracker";

type LoaderDependencies = {
  loadOperationalState?: () => Promise<OperationalCapabilityState>;
  readConfiguredProviderIds?: () => Promise<string[]>;
  loadProviderHealth?: (providerId: string) => Promise<ProviderHealth>;
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
  const readConfiguredProviderIds = dependencies.readConfiguredProviderIds ?? (async () =>
    prisma.modelProvider.findMany({
      where: { retiredAt: null, status: { in: ["active", "degraded"] } },
      select: { providerId: true },
    }).then((rows) => rows.map((row) => row.providerId)));
  const readHealth = dependencies.loadProviderHealth ?? ((providerId: string) =>
    loadProviderHealth(providerId, { runtimeState: getEndpointRuntimeState }));

  const [operational, configuredProviderIds] = await Promise.all([
    loadOperationalState(),
    readConfiguredProviderIds(),
  ]);
  const allowedRuntimeKeys = new Set(
    operational.externalRuntimes.map((runtime) => runtime.runtimeKey),
  );
  const providerState: Record<string, ObservedProviderState> = {};
  const providerIds = configuredProviderIds.filter((providerId) => allowedRuntimeKeys.has(providerId));
  const providerHealth = await Promise.all(
    providerIds.map(async (providerId) => ({ providerId, health: await readHealth(providerId) })),
  );
  for (const { providerId, health } of providerHealth) {
    providerState[providerId] = {
      configured: true,
      healthy: health.status === "healthy" ? true : health.status === "unknown" ? null : false,
      detail: health.safeSummary,
      action: providerHealthAction(health),
      ...(health.adminActionHref ? { actionHref: health.adminActionHref } : {}),
    };
  }

  return projectCapabilityServiceHealth({ ...operational, providerState });
}

function providerHealthAction(health: ProviderHealth): string {
  if (health.status === "unknown") return "Run a request to establish current provider health.";
  switch (health.remediationKind) {
    case "reauth":
      return "Reconnect this provider to restore access.";
    case "wait":
      return "Wait for automatic recovery, then retry the request.";
    case "provider_settings":
      return "Open provider settings to restore availability.";
    case "choose_smaller_request":
      return "Retry with a smaller request.";
    case "none":
      return "Manage availability and credentials with the configured provider.";
  }
}
