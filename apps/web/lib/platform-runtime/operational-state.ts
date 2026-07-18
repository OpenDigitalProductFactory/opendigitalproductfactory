import {
  projectCapabilityServices,
  type CapabilityServiceRequirement,
  type ExternalRuntimeRequirement,
  type LiveCapabilityState,
} from "./capability-service-projection";
import { readFile } from "node:fs/promises";
import { prisma } from "@dpf/db";

export type OperationalServiceStatus = "required" | "optional_inactive" | "optional_degraded";
export interface ObservedServiceState { composePresent: boolean; healthy: boolean | null }
export interface ObservedProviderState { configured: boolean; healthy: boolean | null }
export interface PersistedInstallSnapshot {
  enabledRuntimeCapabilities: string[];
  capabilityCatalogHash?: string;
  capabilityStateVersion?: string;
}

export interface OperationalCapabilityState {
  catalogVersion: number;
  catalogHash: string;
  capabilityStateVersion: string;
  persistedCatalogHash: string | null;
  persistedStateVersion: string | null;
  enabledRuntimeCapabilities: string[];
  serviceRequirements: CapabilityServiceRequirement[];
  observedServices: Record<string, ObservedServiceState>;
  backupServices: string[];
  externalRuntimes: ExternalRuntimeRequirement[];
  providerState: Record<string, ObservedProviderState>;
  serviceStates: Record<string, OperationalServiceStatus>;
}

export function createOperationalCapabilityState(input: {
  installSnapshot: PersistedInstallSnapshot;
  capabilityStates: LiveCapabilityState[];
  observedServices: Record<string, ObservedServiceState>;
  observedProviders: Record<string, ObservedProviderState>;
}): OperationalCapabilityState {
  const projection = projectCapabilityServices({
    enabledRuntimeCapabilities: input.installSnapshot.enabledRuntimeCapabilities,
    capabilityStates: input.capabilityStates,
  });
  const serviceStates: Record<string, OperationalServiceStatus> = {};
  for (const name of projection.inactiveOptionalServices) serviceStates[name] = "optional_inactive";
  for (const service of projection.serviceRequirements) {
    const observed = input.observedServices[service.service];
    serviceStates[service.service] = service.capability === "runtime:core"
      ? "required"
      : observed?.composePresent && observed.healthy !== false ? "required" : "optional_degraded";
  }
  return {
    catalogVersion: projection.catalogVersion,
    catalogHash: projection.catalogHash,
    capabilityStateVersion: projection.capabilityStateVersion,
    persistedCatalogHash: input.installSnapshot.capabilityCatalogHash ?? null,
    persistedStateVersion: input.installSnapshot.capabilityStateVersion ?? null,
    enabledRuntimeCapabilities: projection.enabledRuntimeCapabilities,
    serviceRequirements: projection.serviceRequirements,
    observedServices: input.observedServices,
    backupServices: projection.backupServices,
    externalRuntimes: projection.externalRuntimes,
    providerState: input.observedProviders,
    serviceStates,
  };
}

export async function loadOperationalCapabilityState(input: {
  observedServices: Record<string, ObservedServiceState>;
  observedProviders: Record<string, ObservedProviderState>;
  readInstallSnapshot?: () => Promise<PersistedInstallSnapshot>;
  readCapabilityStates?: () => Promise<LiveCapabilityState[]>;
}): Promise<OperationalCapabilityState> {
  const readInstallSnapshot = input.readInstallSnapshot ?? (async () =>
    JSON.parse(await readFile("/dpf-state/install-state.json", "utf8")) as PersistedInstallSnapshot);
  const readCapabilityStates = input.readCapabilityStates ?? (async () => {
    const rows = await prisma.platformCapability.findMany({
      select: { capabilityId: true, state: true },
    });
    return rows
      .filter((row): row is { capabilityId: string; state: "active" | "disabled" } => row.state === "active" || row.state === "disabled")
      .map((row) => ({ capabilityId: row.capabilityId, state: row.state }));
  });
  const [installSnapshot, capabilityStates] = await Promise.all([
    readInstallSnapshot(),
    readCapabilityStates(),
  ]);
  return createOperationalCapabilityState({
    installSnapshot,
    capabilityStates,
    observedServices: input.observedServices,
    observedProviders: input.observedProviders,
  });
}
