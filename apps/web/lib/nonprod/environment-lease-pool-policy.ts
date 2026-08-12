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

type PlatformConfigReader = Parameters<
  typeof loadLocalCiPoolConfig
>[0]["platformConfig"];

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
  const clientPressure = input.hostPressure ?? {};
  const preliminary = resolveLocalCiPoolPolicy({
    configValue,
    host: clientPressure,
    manifestSlotCount: input.manifestSlotCount,
    reserveAdmissionHeadroom: input.reserveAdmissionHeadroom,
    env: process.env,
    now: input.now,
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
  });
}
