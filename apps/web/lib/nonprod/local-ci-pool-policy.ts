import pilotGuardrails from "./local-ci-pilot-guardrails.json" with {
  type: "json",
};
import { isRecord as isRecordRuntime } from "../shared/is-record.mjs";
// Type-only: erased at compile time, so this module keeps a runtime import
// graph of relative .mjs/.json alone and stays loadable by the raw-Node script
// tests in scripts/local-ci-pool-policy.test.mjs.
import type {
  InstallationEnvironmentClass,
  InstallationOperatingPurpose,
} from "@dpf/db/installation-operating-intent";
import localCiSlotResources from "./local-ci-slot-resources.json" with {
  type: "json",
};

export const LOCAL_CI_POOL_CONFIG_KEY = "local_ci.sandbox_pool";
export const LOCAL_CI_POOL_POLICY_VERSION = 1 as const;
export const LOCAL_CI_MIN_CAPACITY = 1;
export const LOCAL_CI_MAX_CAPACITY = 2;

export type LocalCiPoolPolicySource =
  | "default"
  | "platform-config"
  // Capacity derived from the installation's own declared environment class and
  // operating intent when no explicit config row exists (BI-D908DA0A). Ranks
  // below `platform-config` so an operator's row always wins.
  | "installation-profile"
  | "test-env"
  | "break-glass-env";

export type LocalCiHostPressure = {
  observedAt?: string;
  availableMemoryBytes?: number;
  dockerAvailableMemoryBytes?: number;
  builderMemoryUsageBytes?: number[];
  sustainedCpuPercent?: number;
  diskFreeBytes?: number;
  dockerHealthy?: boolean;
  convergenceActive?: boolean;
  fencesHealthy?: boolean;
  evidenceIsolationHealthy?: boolean;
};

export type LocalCiPoolConfig = {
  version: 1;
  requestedCapacity: 1 | 2;
  ceilings: {
    minAvailableMemoryBytes: number;
    maxSustainedCpuPercent: number;
    minDiskFreeBytes: number;
  };
  rollback: {
    maxServiceDurationRegressionPercent: number;
    maxInfrastructureFailureRatePercent: number;
    evidenceMismatchTolerance: 0;
  };
};

export type ResolvedLocalCiPoolPolicy = {
  policyVersion: 1;
  source: LocalCiPoolPolicySource;
  requestedCapacity: 1 | 2;
  manifestCapacity: number;
  hostSafeCapacity: 0 | 1 | 2;
  effectiveCapacity: 0 | 1 | 2;
  slotKeys: Array<"slot-0" | "slot-1">;
  rollbackReason: string | null;
  config: LocalCiPoolConfig | null;
};

/**
 * Capacity derived from what the installation declares itself to be
 * (BI-D908DA0A).
 *
 * The pool shipped with a contraction path and no activation path: the only
 * writer of `local_ci.sandbox_pool` is the circuit breaker, which moves capacity
 * from 2 down to 1. Nothing ever created the row, so every installation ran at
 * the compatibility singleton — measured 2026-08-29 as a p90 queue wait of
 * 1053s at 45% utilisation. Adding a "seed the row" switch would keep the
 * defect: a consumer never finds it, and a development host must hand-author
 * JSON to get capacity its hardware already supports.
 *
 * Capacity is a property of THIS installation, and the installation already
 * declares the two facts that decide it. A `development` install whose declared
 * job is `evolve-dpf` runs many gates a day; everything else — every consumer,
 * every production install, and anything undeclared — keeps the singleton.
 * `UNDECLARED_ENVIRONMENT_CLASS` is `production`, so silence resolves to the
 * conservative answer.
 *
 * This decides only what to REQUEST. Host headroom, the pilot guardrails and the
 * circuit breaker all still clamp it downstream and can only reduce it.
 */
export const LOCAL_CI_DEVELOPMENT_PURPOSES: readonly InstallationOperatingPurpose[] =
  Object.freeze(["evolve-dpf"]);

export type LocalCiInstallationProfile = {
  environmentClass: InstallationEnvironmentClass;
  primaryPurpose: InstallationOperatingPurpose;
  secondaryPurposes?: readonly InstallationOperatingPurpose[];
};

export type DerivedLocalCiCapacity = {
  requestedCapacity: 1 | 2;
  /** Why this capacity was chosen. Surfaced to the operator, never swallowed. */
  reason: string;
};

/**
 * Returns null when the installation has not declared enough to decide, so the
 * caller keeps the compatibility singleton rather than inventing a default from
 * silence.
 */
export function deriveLocalCiCapacityFromInstallation(
  profile: LocalCiInstallationProfile | null | undefined,
): DerivedLocalCiCapacity | null {
  if (!profile) return null;
  if (profile.environmentClass !== "development") {
    return {
      requestedCapacity: 1,
      reason: `installation-environment-class-${profile.environmentClass}`,
    };
  }
  const purposes = [
    profile.primaryPurpose,
    ...(profile.secondaryPurposes ?? []),
  ];
  if (!purposes.some((p) => LOCAL_CI_DEVELOPMENT_PURPOSES.includes(p))) {
    return {
      requestedCapacity: 1,
      reason: `installation-purpose-${profile.primaryPurpose}`,
    };
  }
  return {
    requestedCapacity: 2,
    reason: "installation-development-platform-build",
  };
}

/**
 * The config a derived capacity runs under.
 *
 * An explicit row supplies its own ceilings and rollback thresholds. A derived
 * capacity has none, so it borrows the pilot guardrails — the same maxima
 * `localCiPoolConfigError` enforces on a hand-authored row, so a derived config
 * can never be looser than one an operator is allowed to write.
 */
export function derivedLocalCiPoolConfig(
  requestedCapacity: 1 | 2,
): LocalCiPoolConfig {
  return {
    version: 1,
    requestedCapacity,
    ceilings: {
      minAvailableMemoryBytes: 4 * 1024 ** 3,
      maxSustainedCpuPercent: 85,
      minDiskFreeBytes: 50 * 1024 ** 3,
    },
    rollback: {
      maxServiceDurationRegressionPercent:
        pilotGuardrails.maximumMedianServiceDurationRegressionPercent,
      maxInfrastructureFailureRatePercent:
        pilotGuardrails.maximumInfrastructureFailureRatePercent,
      evidenceMismatchTolerance: 0,
    },
  };
}

export function localCiBuildHeadroomCapacity(input: {
  dockerAvailableMemoryBytes: number;
  builderMemoryBytes: number;
  builderMemoryUsageBytes: number[];
  manifestCapacity: number;
}): number {
  if (
    !Number.isFinite(input.dockerAvailableMemoryBytes)
    || input.dockerAvailableMemoryBytes < 0
    || !Number.isFinite(input.builderMemoryBytes)
    || input.builderMemoryBytes <= 0
    || !Number.isFinite(input.manifestCapacity)
    || input.manifestCapacity < 1
    || !Array.isArray(input.builderMemoryUsageBytes)
    || input.builderMemoryUsageBytes.length < Math.floor(input.manifestCapacity)
    || input.builderMemoryUsageBytes.some(
      (value) => !Number.isFinite(value) || value < 0,
    )
  ) {
    return 0;
  }

  let cumulativeReservationBytes = 0;
  let capacity = 0;
  for (const usageBytes of input.builderMemoryUsageBytes.slice(
    0,
    Math.floor(input.manifestCapacity),
  )) {
    cumulativeReservationBytes += Math.max(
      0,
      input.builderMemoryBytes - usageBytes,
    );
    if (cumulativeReservationBytes > input.dockerAvailableMemoryBytes) break;
    capacity += 1;
  }
  return capacity;
}

/**
 * Admission reserves measured demand plus margin. The builder's memoryBytes
 * remains the hard runtime ceiling; an absent or invalid calibration falls
 * back to that ceiling so incomplete evidence can never make admission looser.
 */
export function localCiBuilderAdmissionReserveBytes(input: {
  hardCeilingBytes: number;
  calibratedReserveBytes: number;
}): number {
  if (!Number.isFinite(input.hardCeilingBytes) || input.hardCeilingBytes <= 0) {
    return 0;
  }
  if (
    !Number.isFinite(input.calibratedReserveBytes)
    || input.calibratedReserveBytes <= 0
  ) {
    return input.hardCeilingBytes;
  }
  return Math.min(input.hardCeilingBytes, input.calibratedReserveBytes);
}

/**
 * Host-stage admission reserve, calibrated the way the builder's already was
 * (BI-E58B57EC).
 *
 * `hostStagePolicy.memoryBytes` was a flat 8 GiB with no calibration block,
 * while the builder's had been measured down from a 16 GiB ceiling to a 10 GiB
 * reserve against an 8 GiB observed high-water. Measured 2026-08-29: peak
 * combined node working set on the Windows host during the heaviest host-side
 * stage was 2.27 GiB over idle baseline — a 3.5x over-reservation.
 *
 * That single uncalibrated number was the whole reason a second slot could not
 * admit on a 63.7 GiB host: `floor((16.9 - 4) / 8)` is 1.
 *
 * Same shape as {@link localCiBuilderAdmissionReserveBytes}: the ceiling stays
 * the hard runtime limit, admission reserves the calibrated figure, and missing
 * or invalid calibration falls back to the ceiling so incomplete evidence can
 * never make admission looser.
 */
export function localCiHostStageAdmissionReserveBytes(input: {
  hardCeilingBytes: number;
  calibratedReserveBytes: number;
}): number {
  return localCiBuilderAdmissionReserveBytes(input);
}

/**
 * Number of host-native stage slots that can start without spending the
 * configured continuation floor. The floor is the active-stage safety fence;
 * the stage envelope is predictable Node/TypeScript/Vitest growth that must be
 * reserved before admission rather than discovered by killing the stage.
 */
export function localCiHostStageHeadroomCapacity(input: {
  availableMemoryBytes: number;
  minAvailableMemoryBytes: number;
  hostStageMemoryBytes: number;
  manifestCapacity: number;
}): number {
  if (
    !Number.isFinite(input.availableMemoryBytes)
    || input.availableMemoryBytes < 0
    || !Number.isFinite(input.minAvailableMemoryBytes)
    || input.minAvailableMemoryBytes < 0
    || !Number.isFinite(input.hostStageMemoryBytes)
    || input.hostStageMemoryBytes <= 0
    || !Number.isFinite(input.manifestCapacity)
    || input.manifestCapacity < 1
  ) {
    return 0;
  }

  const reservableBytes = Math.max(
    0,
    input.availableMemoryBytes - input.minAvailableMemoryBytes,
  );
  return Math.min(
    Math.floor(input.manifestCapacity),
    Math.floor(reservableBytes / input.hostStageMemoryBytes),
  );
}

type PolicyEnv = Record<string, string | undefined>;
type PlatformConfigReader = {
  findUnique: (args: {
    where: { key: string };
    select: { value: true };
  }) => Promise<{ value: unknown } | null>;
};

export async function loadLocalCiPoolConfig(input: {
  platformConfig: PlatformConfigReader;
}): Promise<unknown> {
  const row = await input.platformConfig.findUnique({
    where: { key: LOCAL_CI_POOL_CONFIG_KEY },
    select: { value: true },
  });
  return row?.value ?? null;
}

function finiteAtLeast(value: unknown, floor: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= floor;
}

const isObjectRecord = isRecordRuntime as (
  value: unknown,
) => value is Record<string, unknown>;

function finitePercent(value: unknown): value is number {
  return finiteAtLeast(value, 0) && value <= 100;
}

function hasExactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length
    && actual.every((key, index) => key === expected[index]);
}

export function localCiPoolConfigError(value: unknown): string | null {
  if (value === null || value === undefined) return "config-absent";
  if (!isObjectRecord(value)) return "config-malformed";
  if (!hasExactKeys(value, ["version", "requestedCapacity", "ceilings", "rollback"])) {
    return "config-shape-invalid";
  }
  if (value.version !== LOCAL_CI_POOL_POLICY_VERSION) {
    return "config-version-unsupported";
  }
  if (value.requestedCapacity !== 1 && value.requestedCapacity !== 2) {
    return "config-capacity-invalid";
  }
  if (!isObjectRecord(value.ceilings)
    || !hasExactKeys(value.ceilings, [
      "minAvailableMemoryBytes",
      "maxSustainedCpuPercent",
      "minDiskFreeBytes",
    ])
    || !finiteAtLeast(value.ceilings.minAvailableMemoryBytes, 1)
    || !finitePercent(value.ceilings.maxSustainedCpuPercent)
    || !finiteAtLeast(value.ceilings.minDiskFreeBytes, 1)) {
    return "config-ceilings-invalid";
  }
  if (!isObjectRecord(value.rollback)
    || !hasExactKeys(value.rollback, [
      "maxServiceDurationRegressionPercent",
      "maxInfrastructureFailureRatePercent",
      "evidenceMismatchTolerance",
    ])
    || !finitePercent(value.rollback.maxServiceDurationRegressionPercent)
    || value.rollback.maxServiceDurationRegressionPercent
      > pilotGuardrails.maximumMedianServiceDurationRegressionPercent
    || !finitePercent(value.rollback.maxInfrastructureFailureRatePercent)
    || value.rollback.maxInfrastructureFailureRatePercent
      > pilotGuardrails.maximumInfrastructureFailureRatePercent
    || value.rollback.evidenceMismatchTolerance !== 0) {
    return "config-rollback-invalid";
  }
  return null;
}

function normalizeConfig(value: unknown): LocalCiPoolConfig {
  return value as LocalCiPoolConfig;
}

function authorizedCapacityOverride(
  env: PolicyEnv | undefined,
): { capacity: 1 | 2; source: "test-env" | "break-glass-env" } | null {
  const raw = env?.DPF_LOCAL_CI_POOL_CAPACITY;
  if (raw !== "1" && raw !== "2") return null;
  if (env?.NODE_ENV === "test") {
    return { capacity: Number(raw) as 1 | 2, source: "test-env" };
  }
  if (env?.DPF_LOCAL_CI_POOL_BREAK_GLASS === "1") {
    return { capacity: Number(raw) as 1 | 2, source: "break-glass-env" };
  }
  return null;
}

function singleton(input: {
  source: LocalCiPoolPolicySource;
  requestedCapacity?: 1 | 2;
  manifestCapacity: number;
  reason: string;
  config?: LocalCiPoolConfig | null;
}): ResolvedLocalCiPoolPolicy {
  return {
    policyVersion: LOCAL_CI_POOL_POLICY_VERSION,
    source: input.source,
    requestedCapacity: input.requestedCapacity ?? 1,
    manifestCapacity: input.manifestCapacity,
    hostSafeCapacity: 1,
    effectiveCapacity: 1,
    slotKeys: ["slot-0"],
    rollbackReason: input.reason,
    config: input.config ?? null,
  };
}

function unavailable(input: {
  source: LocalCiPoolPolicySource;
  requestedCapacity: 1 | 2;
  manifestCapacity: number;
  reason: string;
  config: LocalCiPoolConfig;
}): ResolvedLocalCiPoolPolicy {
  return {
    policyVersion: LOCAL_CI_POOL_POLICY_VERSION,
    source: input.source,
    requestedCapacity: input.requestedCapacity,
    manifestCapacity: input.manifestCapacity,
    hostSafeCapacity: 0,
    effectiveCapacity: 0,
    slotKeys: [],
    rollbackReason: input.reason,
    config: input.config,
  };
}

function hostRollbackReason(
  host: LocalCiHostPressure,
  config: LocalCiPoolConfig,
  now: Date,
): string | null {
  const observedAt = typeof host.observedAt === "string"
    ? Date.parse(host.observedAt)
    : Number.NaN;
  if (!Number.isFinite(observedAt)) return "host-observation-unmeasurable";
  if (Math.abs(now.getTime() - observedAt) > 2 * 60_000) {
    return "host-observation-stale";
  }
  if (!finiteAtLeast(host.availableMemoryBytes, 0)) {
    return "host-memory-unmeasurable";
  }
  if (host.availableMemoryBytes < config.ceilings.minAvailableMemoryBytes) {
    return "host-memory-low";
  }
  if (!finitePercent(host.sustainedCpuPercent)) {
    return "host-cpu-unmeasurable";
  }
  if (host.sustainedCpuPercent > config.ceilings.maxSustainedCpuPercent) {
    return "host-cpu-high";
  }
  if (!finiteAtLeast(host.diskFreeBytes, 0)) {
    return "host-disk-unmeasurable";
  }
  if (host.diskFreeBytes < config.ceilings.minDiskFreeBytes) {
    return "host-disk-low";
  }
  if (host.dockerHealthy !== true) return "docker-unhealthy";
  if (host.convergenceActive !== false) return "dependency-convergence-active";
  if (host.fencesHealthy !== true) return "slot-fence-unhealthy";
  if (host.evidenceIsolationHealthy !== true) {
    return "evidence-isolation-unproven";
  }
  return null;
}

/**
 * Resolve the one capacity decision consumed by both durable admission and
 * shared-lease WIP reporting. Missing configuration preserves the compatibility
 * singleton; ambiguous host safety under a valid policy contracts to zero.
 */
export function resolveLocalCiPoolPolicy(input: {
  configValue: unknown;
  host: LocalCiHostPressure;
  manifestSlotCount: number;
  reserveAdmissionHeadroom?: boolean;
  env?: PolicyEnv;
  now?: Date;
  /**
   * What this installation has declared itself to be. Consulted only when no
   * valid config row exists, so an operator's explicit row always wins.
   */
  installation?: LocalCiInstallationProfile | null;
}): ResolvedLocalCiPoolPolicy {
  const manifestCapacity = Number.isFinite(input.manifestSlotCount)
    && input.manifestSlotCount >= LOCAL_CI_MIN_CAPACITY
    ? Math.min(LOCAL_CI_MAX_CAPACITY, Math.floor(input.manifestSlotCount))
    : LOCAL_CI_MIN_CAPACITY;
  const configError = localCiPoolConfigError(input.configValue);

  // No usable row. Before falling back to the compatibility singleton, ask what
  // the installation says it is (BI-D908DA0A). A development install whose
  // declared job is evolving the platform gets the capacity its host can carry;
  // a consumer or production install, or one that has not declared itself, keeps
  // the singleton. Host headroom still clamps whatever comes back.
  const derived = configError
    ? deriveLocalCiCapacityFromInstallation(input.installation)
    : null;
  if (configError && !derived) {
    return singleton({
      source: "default",
      manifestCapacity,
      reason: configError,
    });
  }
  if (configError && derived && derived.requestedCapacity === 1) {
    return singleton({
      source: "installation-profile",
      requestedCapacity: 1,
      manifestCapacity,
      reason: derived.reason,
    });
  }

  const config = derived
    ? normalizeConfig(derivedLocalCiPoolConfig(derived.requestedCapacity))
    : normalizeConfig(input.configValue);
  const override = authorizedCapacityOverride(input.env);
  const requestedCapacity = override?.capacity ?? config.requestedCapacity;
  const source: LocalCiPoolPolicySource = override?.source
    ?? (derived ? "installation-profile" : "platform-config");

  const rollbackReason = hostRollbackReason(
    input.host,
    config,
    input.now ?? new Date(),
  );
  if (rollbackReason) {
    return unavailable({
      source,
      requestedCapacity,
      manifestCapacity,
      reason: rollbackReason,
      config,
    });
  }

  if (input.reserveAdmissionHeadroom) {
    const builderMemoryBytes = localCiBuilderAdmissionReserveBytes({
      hardCeilingBytes: localCiSlotResources.builderPolicy.memoryBytes,
      calibratedReserveBytes:
        localCiSlotResources.builderPolicy.admissionReserveBytes,
    });
    const hostBuildCapacity = localCiBuildHeadroomCapacity({
      dockerAvailableMemoryBytes:
        input.host.dockerAvailableMemoryBytes ?? Number.NaN,
      builderMemoryBytes,
      builderMemoryUsageBytes: input.host.builderMemoryUsageBytes ?? [],
      manifestCapacity,
    });

    if (hostBuildCapacity === 0) {
      return unavailable({
        source,
        requestedCapacity,
        manifestCapacity,
        reason: "host-build-headroom-low",
        config,
      });
    }
    const hostStageCapacity = localCiHostStageHeadroomCapacity({
      availableMemoryBytes: input.host.availableMemoryBytes ?? Number.NaN,
      minAvailableMemoryBytes: config.ceilings.minAvailableMemoryBytes,
      hostStageMemoryBytes: localCiHostStageAdmissionReserveBytes({
        hardCeilingBytes: localCiSlotResources.hostStagePolicy.memoryBytes,
        calibratedReserveBytes:
          localCiSlotResources.hostStagePolicy.admissionReserveBytes,
      }),
      manifestCapacity,
    });
    if (hostStageCapacity === 0) {
      return unavailable({
        source,
        requestedCapacity,
        manifestCapacity,
        reason: "host-stage-headroom-low",
        config,
      });
    }
    if (hostBuildCapacity === 1 && requestedCapacity === 2) {
      return singleton({
        source,
        requestedCapacity,
        manifestCapacity,
        reason: "host-build-capacity-one",
        config,
      });
    }
    if (hostStageCapacity === 1 && requestedCapacity === 2) {
      return singleton({
        source,
        requestedCapacity,
        manifestCapacity,
        reason: "host-stage-capacity-one",
        config,
      });
    }
  }

  if (requestedCapacity === 1) {
    return singleton({
      source,
      requestedCapacity,
      manifestCapacity,
      reason: "requested-singleton",
      config,
    });
  }
  if (manifestCapacity < LOCAL_CI_MAX_CAPACITY) {
    return singleton({
      source,
      requestedCapacity,
      manifestCapacity,
      reason: "manifest-capacity-one",
      config,
    });
  }

  return {
    policyVersion: LOCAL_CI_POOL_POLICY_VERSION,
    source,
    requestedCapacity,
    manifestCapacity,
    hostSafeCapacity: 2,
    effectiveCapacity: 2,
    slotKeys: ["slot-0", "slot-1"],
    rollbackReason: null,
    config,
  };
}
