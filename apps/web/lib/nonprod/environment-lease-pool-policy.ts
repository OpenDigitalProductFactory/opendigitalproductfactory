import {
  mergeLocalCiHostPressure,
  observeLocalCiServerPressure,
  type LocalCiCapacityBroker,
} from "./local-ci-capacity-broker";
import {
  loadLocalCiPoolConfig,
  resolveLocalCiPoolPolicy,
  type LocalCiHostPressure,
  type ResolvedLocalCiPoolPolicy,
} from "./local-ci-pool-policy";
import { readLocalCiInstallationProfile } from "./local-ci-capacity-profile";
import {
  resolveHostResourceAdmission,
  type ActiveHeavyReservation,
  type HeavyResourceClass,
} from "./host-resource-policy";

type PlatformConfigReader = Parameters<
  typeof loadLocalCiPoolConfig
>[0]["platformConfig"];

export interface HostResourcePressure {
  totalMemoryBytes: number;
  availableMemoryBytes: number;
  inferenceResident: boolean;
}

export interface HostResourceLeaseEvidence extends HostResourcePressure {
  ungovernedProcesses?: Array<{
    pid: number;
    parentPid: number;
    resourceClass: string;
    commandLine: string;
    disposition: "evidence-only";
  }>;
}

export interface ResolvedHostResourcePoolPolicy {
  policyVersion: 1;
  source: "host-resource-profile";
  requestedCapacity: number;
  manifestCapacity: 1;
  hostSafeCapacity: number;
  effectiveCapacity: 0 | 1;
  slotKeys: ["slot-0"] | [];
  rollbackReason: string | null;
  config: null;
}

/** Adapter from the typed host policy to the durable lease pool shape. */
export function resolveHostResourcePoolPolicy(input: {
  resourceClass: HeavyResourceClass;
  expectedMemoryBytes: number;
  hostResource: HostResourcePressure;
  activeReservations: ActiveHeavyReservation[];
}): ResolvedHostResourcePoolPolicy {
  const admission = resolveHostResourceAdmission({
    resourceClass: input.resourceClass,
    expectedMemoryBytes: input.expectedMemoryBytes,
    totalMemoryBytes: input.hostResource.totalMemoryBytes,
    availableMemoryBytes: input.hostResource.availableMemoryBytes,
    inferenceResident: input.hostResource.inferenceResident,
    activeHeavyReservations: input.activeReservations,
  });
  const admitted = admission.status === "admitted";
  const requestedCapacity = "capacity" in admission ? admission.capacity : 1;
  return {
    policyVersion: 1,
    source: "host-resource-profile",
    requestedCapacity,
    manifestCapacity: 1,
    hostSafeCapacity: admitted ? 1 : 0,
    effectiveCapacity: admitted ? 1 : 0,
    slotKeys: admitted ? ["slot-0"] : [],
    rollbackReason: admitted ? null : admission.reason,
    config: null,
  };
}

export async function resolveNonprodPoolPolicy(input: {
  platformConfig: PlatformConfigReader | undefined;
  environmentKey: string;
  hostPressure?: LocalCiHostPressure;
  capacityBroker?: LocalCiCapacityBroker;
  manifestSlotCount: number;
  reserveAdmissionHeadroom?: boolean;
  now: Date;
}): Promise<ResolvedLocalCiPoolPolicy> {
  if (input.environmentKey !== "local-integration-ci") {
    return {
      policyVersion: 1,
      source: "default",
      requestedCapacity: 1,
      manifestCapacity: 1,
      hostSafeCapacity: 1,
      effectiveCapacity: 1,
      slotKeys: ["slot-0"],
      rollbackReason: "environment-singleton",
      config: null,
    };
  }
  const configValue = input.platformConfig
    ? await loadLocalCiPoolConfig({ platformConfig: input.platformConfig })
    : null;
  // Consulted only when no valid config row exists (BI-D908DA0A). A read failure
  // is not a reason to guess: an unreadable declaration resolves to null and the
  // policy keeps the compatibility singleton.
  const installation = input.platformConfig
    ? await readLocalCiInstallationProfile({
      platformConfig: input.platformConfig,
    }).catch(() => null)
    : null;
  const clientPressure = input.hostPressure ?? {};
  const preliminary = resolveLocalCiPoolPolicy({
    configValue,
    host: clientPressure,
    manifestSlotCount: input.manifestSlotCount,
    reserveAdmissionHeadroom: input.reserveAdmissionHeadroom,
    env: process.env,
    now: input.now,
    installation,
  });
  // A missing/malformed config keeps the compatibility singleton and has no
  // broker contract to enforce. A valid configured singleton still requires
  // canonical pressure: "one requested" is not permission to admit on an
  // unsafe host.
  if (preliminary.config === null) return preliminary;

  let serverPressure: LocalCiHostPressure;
  try {
    serverPressure = await (
      input.capacityBroker ?? observeLocalCiServerPressure
    )();
  } catch {
    serverPressure = {
      observedAt: input.now.toISOString(),
      dockerHealthy: false,
      convergenceActive: true,
      fencesHealthy: false,
      evidenceIsolationHealthy: false,
    };
  }
  return resolveLocalCiPoolPolicy({
    configValue,
    host: mergeLocalCiHostPressure({
      client: clientPressure,
      server: serverPressure,
    }),
    manifestSlotCount: input.manifestSlotCount,
    reserveAdmissionHeadroom: input.reserveAdmissionHeadroom,
    env: process.env,
    now: input.now,
    installation,
  });
}
