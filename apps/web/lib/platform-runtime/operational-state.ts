import {
  projectCapabilityServices,
  type CapabilityServiceRequirement,
  type ExternalRuntimeRequirement,
  type LiveCapabilityState,
} from "./capability-service-projection";
import { readFile } from "node:fs/promises";
import { prisma } from "@dpf/db";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

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
  capabilityBackupCandidates: string[];
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
  if (input.installSnapshot.capabilityCatalogHash && input.installSnapshot.capabilityCatalogHash !== projection.catalogHash) {
    throw new Error("install_catalog_stale");
  }
  if (input.installSnapshot.capabilityStateVersion && input.installSnapshot.capabilityStateVersion !== projection.capabilityStateVersion) {
    throw new Error("install_capability_state_stale");
  }
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
    capabilityBackupCandidates: projection.capabilityBackupCandidates,
    externalRuntimes: projection.externalRuntimes,
    providerState: input.observedProviders,
    serviceStates,
  };
}

export async function loadOperationalCapabilityState(input: {
  observedServices?: Record<string, ObservedServiceState>;
  observedProviders: Record<string, ObservedProviderState>;
  readInstallSnapshot?: () => Promise<PersistedInstallSnapshot>;
  readCapabilityStates?: () => Promise<LiveCapabilityState[]>;
}): Promise<OperationalCapabilityState> {
  const readInstallSnapshot = input.readInstallSnapshot ?? (async () =>
    JSON.parse(await readFile("/dpf-state/install-state.json", "utf8")) as PersistedInstallSnapshot);
  const readCapabilityStates = input.readCapabilityStates ?? (async () => {
    const rows = await prisma.platformCapability.findMany({
      where: { capabilityId: { startsWith: "runtime:" } },
      select: { capabilityId: true, state: true },
    });
    return rows.map((row) => ({ capabilityId: row.capabilityId, state: row.state as LiveCapabilityState["state"] }));
  });
  const [installSnapshot, capabilityStates, observedServices] = await Promise.all([
    readInstallSnapshot(),
    readCapabilityStates(),
    input.observedServices ? Promise.resolve(input.observedServices) : observeComposeServices(),
  ]);
  return createOperationalCapabilityState({
    installSnapshot,
    capabilityStates,
    observedServices,
    observedProviders: input.observedProviders,
  });
}

const execFileAsync = promisify(execFile);
export async function observeComposeServices(): Promise<Record<string, ObservedServiceState>> {
  const { stdout } = await execFileAsync("docker", ["compose", "ps", "--format", "json", "--all"], { timeout: 10_000, encoding: "utf8" });
  const trimmed = stdout.trim();
  if (!trimmed) return {};
  let records: Array<Record<string, unknown>>;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    records = Array.isArray(parsed) ? parsed as Array<Record<string, unknown>> : [parsed as Record<string, unknown>];
  } catch {
    records = trimmed.split(/\r?\n/).map((line) => JSON.parse(line) as Record<string, unknown>);
  }
  return Object.fromEntries(records.map((record) => {
    const service = String(record.Service ?? record.service ?? "");
    if (!service) throw new Error("compose_observation_missing_service");
    const state = String(record.State ?? record.state ?? "").toLowerCase();
    const health = String(record.Health ?? record.health ?? "").toLowerCase();
    return [service, { composePresent: true, healthy: state === "running" && (!health || health === "healthy") }];
  }));
}
