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
  serviceRequirements: CapabilityServiceRequirement[];
  externalRuntimes: ExternalRuntimeRequirement[];
}

interface GeneratedCapability {
  capabilityId: string;
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
  const liveById = new Map(input.capabilityStates.map((item) => [item.capabilityId, item.state]));
  for (const capability of generatedCatalog.capabilities) {
    const live = liveById.get(capability.capabilityId);
    if (live && (live === "active") !== enabled.has(capability.capabilityId)) {
      throw new Error(`capability_state_stale:${capability.capabilityId}`);
    }
  }

  const capabilities = generatedCatalog.capabilities.map((entry) => ({
    capabilityId: entry.capabilityId,
    state: enabled.has(entry.capabilityId) ? "active" : "disabled",
    manifest: { runtime: { dependencies: entry.dependencies, activation: { policy: entry.activationPolicy }, workGuards: entry.workGuards } },
  }));
  const substrate = {
    version: generatedCatalog.substrateManifestVersion,
    services: generatedCatalog.capabilities.flatMap((entry) => entry.services),
    externalRuntimes: generatedCatalog.capabilities.flatMap((entry) => entry.externalRuntimes),
  };

  return resolveCapabilityServiceProjection({
    substrate,
    capabilities,
    enabledRuntimeCapabilities: input.enabledRuntimeCapabilities,
  }) as CapabilityServiceProjection;
}

export const capabilityServiceCatalogIdentity = Object.freeze({
  catalogVersion: generatedCatalog.catalogVersion,
  catalogHash: generatedCatalog.catalogHash,
});
