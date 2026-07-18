import {
  projectCapabilityServices,
  type CapabilityServiceRequirement,
  type ExternalRuntimeRequirement,
  type LiveCapabilityState,
} from "./capability-service-projection";
import { readFile } from "node:fs/promises";
import { prisma } from "@dpf/db";
import { request } from "node:http";

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

function dockerSocketGet(path: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const req = request({ socketPath: "/var/run/docker.sock", path, method: "GET" }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      response.on("end", () => {
        if ((response.statusCode ?? 500) >= 400) return reject(new Error(`docker_engine_http_${response.statusCode}`));
        try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); } catch (error) { reject(error); }
      });
    });
    req.on("error", reject); req.end();
  });
}
