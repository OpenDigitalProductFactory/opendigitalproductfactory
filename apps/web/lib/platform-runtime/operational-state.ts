import {
  projectCapabilityServices,
  type CapabilityServiceRequirement,
  type ExternalRuntimeRequirement,
  type LiveCapabilityState,
} from "./capability-service-projection";
import { readFile } from "node:fs/promises";
import { prisma } from "@dpf/db";
import { dockerSocketGet } from "./docker-socket.mjs";
export { boundedDockerSocketGet } from "./docker-socket.mjs";

import {
  diagnoseCapabilityStateDivergence,
  isCapabilityStateStaleError,
} from "./capability-state-divergence";

export type OperationalServiceStatus = "required" | "optional_inactive" | "optional_degraded";
export interface ObservedServiceState { composePresent: boolean; healthy: boolean | null }
export interface ObservedProviderState {
  configured: boolean;
  healthy: boolean | null;
  detail?: string;
  action?: string;
  actionHref?: string;
}
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
  capabilityBackupPolicies: Record<string, import("./capability-service-projection").BackupPolicy>;
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
  // The projection fails closed on drift, and should: guessing which of the two
  // authorities to believe would hand backup and readiness a topology neither
  // source claims. But it names only the FIRST mismatch, and it throws inside
  // the loader that the runtime-health and backup-readiness surfaces call — so
  // the platform detected the condition and then lost it (BI-5ACBAC50).
  //
  // Re-raise with the full diagnosis attached: every drifted capability and the
  // direction of each. Same failure, same fail-closed semantics, an error an
  // operator can act on instead of one identifier out of six.
  let projection;
  try {
    projection = projectCapabilityServices({
      enabledRuntimeCapabilities: input.installSnapshot.enabledRuntimeCapabilities,
      capabilityStates: input.capabilityStates,
    });
  } catch (error) {
    if (!isCapabilityStateStaleError(error)) throw error;
    const report = diagnoseCapabilityStateDivergence({
      enabledRuntimeCapabilities: input.installSnapshot.enabledRuntimeCapabilities,
      capabilityStates: input.capabilityStates,
    });
    const enriched = new Error(
      `${error instanceof Error ? error.message : String(error)} — ${report.summary}`,
    );
    // Keep the machine-readable report on the error so a caller that wants to
    // render the condition does not have to re-derive it from prose.
    (enriched as Error & { divergence?: unknown }).divergence = report;
    if (error instanceof Error) enriched.cause = error;
    throw enriched;
  }
  if (!/^[a-f0-9]{64}$/.test(input.installSnapshot.capabilityCatalogHash ?? "")) throw new Error("install_catalog_identity_invalid");
  if (!/^[a-f0-9]{64}$/.test(input.installSnapshot.capabilityStateVersion ?? "")) throw new Error("install_capability_state_identity_invalid");
  if (input.installSnapshot.capabilityCatalogHash !== projection.catalogHash) {
    throw new Error("install_catalog_stale");
  }
  if (input.installSnapshot.capabilityStateVersion !== projection.capabilityStateVersion) {
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
    capabilityBackupPolicies: projection.capabilityBackupPolicies,
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
  readObservedServices?: () => Promise<Record<string, ObservedServiceState>>;
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
    input.observedServices ? Promise.resolve(input.observedServices) : (input.readObservedServices ? input.readObservedServices() : observeDockerProjectServices()),
  ]);
  return createOperationalCapabilityState({
    installSnapshot,
    capabilityStates,
    observedServices,
    observedProviders: input.observedProviders,
  });
}

type DockerGet = (path: string) => Promise<unknown>;
export async function observeDockerProjectServices(get: DockerGet = dockerSocketGet): Promise<Record<string, ObservedServiceState>> {
  try {
    const hostname = process.env.HOSTNAME;
    if (!hostname) return {};
    const current = await get(`/containers/${encodeURIComponent(hostname)}/json`) as { Config?: { Labels?: Record<string, string> } };
    const project = current.Config?.Labels?.["com.docker.compose.project"];
    if (!project) return {};
    const containers = await get("/containers/json?all=1") as Array<{ State?: string; Status?: string; Labels?: Record<string, string> }>;
    return Object.fromEntries(containers.filter((item) => item.Labels?.["com.docker.compose.project"] === project).flatMap((item) => {
      const service = item.Labels?.["com.docker.compose.service"];
      if (!service) return [];
      const state = String(item.State ?? "").toLowerCase();
      const status = String(item.Status ?? "").toLowerCase();
      return [[service, { composePresent: true, healthy: state === "running" && !status.includes("unhealthy") && !status.includes("health: starting") }]];
    }));
  } catch { return {}; }
}
