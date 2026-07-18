import {
  loadOperationalCapabilityState,
  type OperationalCapabilityState,
  type ObservedProviderState,
} from "./operational-state";
import {
  projectCapabilityServiceHealth,
  type CapabilityServiceHealthProjection,
} from "./service-health";
import {
  loadProviderHealthBatch,
  type ProviderHealthBatchEntry,
} from "@/lib/routing/provider-health-loader";
import type { ProviderHealth } from "@/lib/routing/provider-health";
import { providerDetailHref } from "@/lib/routing/provider-health";
import { getEndpointRuntimeState } from "@/lib/routing/rate-tracker";

type LoaderDependencies = {
  loadOperationalState?: () => Promise<OperationalCapabilityState>;
  loadProviderHealthBatch?: (
    providerIds: string[],
  ) => Promise<Map<string, ProviderHealthBatchEntry>>;
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
  const readHealthBatch = dependencies.loadProviderHealthBatch ?? ((providerIds: string[]) =>
    loadProviderHealthBatch(providerIds, { runtimeState: getEndpointRuntimeState }));

  const operational = await loadOperationalState();
  const allowedRuntimeKeys = new Set(
    operational.externalRuntimes.map((runtime) => runtime.runtimeKey),
  );
  const providerState: Record<string, ObservedProviderState> = {};
  const providerIds = [...allowedRuntimeKeys].sort();
  let providerHealth: Map<string, ProviderHealthBatchEntry>;
  try {
    providerHealth = await readHealthBatch(providerIds);
  } catch {
    console.error("[capability-service-health] provider observations unavailable", {
      event: "provider_health_batch_unavailable",
      providerCount: providerIds.length,
    });
    // The operational capability boundary is still authoritative for local
    // services. Without provider configuration evidence, omit external rows
    // instead of fabricating that any provider is configured.
    providerHealth = new Map();
  }
  for (const providerId of providerIds) {
    const entry = providerHealth.get(providerId);
    if (!entry) continue;
    if (entry.status === "rejected") {
      if (!entry.configured) continue;
      providerState[providerId] = {
        configured: true,
        healthy: null,
        detail: "Provider health evidence is temporarily unavailable.",
        action: "Open provider settings or retry after health evidence refreshes.",
        actionHref: providerDetailHref(providerId),
      };
      continue;
    }
    const health = entry.value;
    if (health.status === "unconfigured") continue;
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
