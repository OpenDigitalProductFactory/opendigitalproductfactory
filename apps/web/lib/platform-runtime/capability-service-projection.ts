import catalog from "../../../../scripts/capability-service-catalog.generated.json";
import { resolveCapabilityServiceProjection } from "../../../../scripts/lib/capability-service-projection.mjs";

export type CapabilityState = "active" | "disabled";
export type BackupPolicy = "included" | "separate-required" | "excluded-ephemeral" | "excluded-rebuildable" | "excluded-stateless";

export interface LiveCapabilityState {
  capabilityId: string;
  state: CapabilityState;
}

export interface CapabilityServiceRequirement {
  service: string;
  capability: string;
  backupPolicy: BackupPolicy;
  healthSemantics: string;
  dependsOn: string[];
  profiles: string[];
  volumes: string[];
  [key: string]: unknown;
}

export interface ExternalRuntimeRequirement {
  runtimeKey: string;
  healthSemantics: string;
  [key: string]: unknown;
}

export interface CapabilityServiceProjection {
  catalogVersion: number;
  catalogHash: string;
  capabilityStateVersion: string;
  enabledRuntimeCapabilities: string[];
  requiredServices: string[];
  inactiveOptionalServices: string[];
  backupServices: string[];
  capabilityBackupCandidates: string[];
  capabilityBackupPolicies: Record<string, BackupPolicy>;
  serviceRequirements: CapabilityServiceRequirement[];
  externalRuntimes: ExternalRuntimeRequirement[];
}

interface GeneratedCapability {
  capabilityId: string;
  /** Absent means active. "retired" = the platform withdrew it; installs migrate off it (BI-5AA0345E). */
  lifecycle?: "retired";
  dependencies: string[];
  activationPolicy: string;
  workGuards: string[];
  services: CapabilityServiceRequirement[];
  externalRuntimes: ExternalRuntimeRequirement[];
}

const generatedCatalog = catalog as unknown as {
  catalogVersion: number;
  catalogHash: string;
  substrateManifestVersion: number;
  capabilities: GeneratedCapability[];
};

/** Typed web adapter over the generated catalog. Dependency closure remains owned by the generator resolver. */
export function projectCapabilityServices(input: {
  enabledRuntimeCapabilities: string[];
  capabilityStates: LiveCapabilityState[];
}): CapabilityServiceProjection {
  const enabled = new Set(input.enabledRuntimeCapabilities);
  const catalogIds = new Set(generatedCatalog.capabilities.map((item) => item.capabilityId));
  if (enabled.size !== input.enabledRuntimeCapabilities.length) throw new Error("duplicate_enabled_runtime_capability");
  for (const id of enabled) if (!catalogIds.has(id)) throw new Error(`unknown_runtime_capability:${id}`);
  const liveById = new Map<string, CapabilityState>();
  for (const item of input.capabilityStates) {
    if (!catalogIds.has(item.capabilityId)) throw new Error(`unknown_live_capability:${item.capabilityId}`);
    if (item.state !== "active" && item.state !== "disabled") throw new Error(`invalid_live_capability_state:${item.capabilityId}`);
    if (liveById.has(item.capabilityId)) throw new Error(`duplicate_live_capability:${item.capabilityId}`);
    liveById.set(item.capabilityId, item.state);
  }
  for (const capability of generatedCatalog.capabilities) {
    const live = liveById.get(capability.capabilityId);
    if (!live) throw new Error(`missing_live_capability:${capability.capabilityId}`);
    if ((live === "active") !== enabled.has(capability.capabilityId)) {
      throw new Error(`capability_state_stale:${capability.capabilityId}`);
    }
  }

  const capabilities = generatedCatalog.capabilities.map((entry) => ({
    capabilityId: entry.capabilityId,
    state: liveById.get(entry.capabilityId),
    manifest: { runtime: { dependencies: entry.dependencies, activation: { policy: entry.activationPolicy }, workGuards: entry.workGuards } },
  }));
  const substrate = {
    version: generatedCatalog.substrateManifestVersion,
    services: generatedCatalog.capabilities.flatMap((entry) => entry.services),
    externalRuntimes: generatedCatalog.capabilities.flatMap((entry) => entry.externalRuntimes),
  };

  const projection = resolveCapabilityServiceProjection({
    substrate,
    capabilities,
    enabledRuntimeCapabilities: input.enabledRuntimeCapabilities,
    hostPlatform: undefined,
  });
  return {
    ...projection,
    capabilityBackupCandidates: generatedCatalog.capabilities
      .filter((entry) => entry.capabilityId !== "runtime:core")
      .flatMap((entry) => entry.services)
      .filter((service) => service.backupPolicy === "included" || service.backupPolicy === "separate-required")
      .map((service) => service.service)
      .sort(),
    capabilityBackupPolicies: Object.fromEntries(generatedCatalog.capabilities
      .filter((entry) => entry.capabilityId !== "runtime:core")
      .flatMap((entry) => entry.services)
      .filter((service) => service.backupPolicy === "included" || service.backupPolicy === "separate-required")
      .map((service) => [service.service, service.backupPolicy])),
  };
}

export const capabilityServiceCatalogIdentity = Object.freeze({
  catalogVersion: generatedCatalog.catalogVersion,
  catalogHash: generatedCatalog.catalogHash,
});
