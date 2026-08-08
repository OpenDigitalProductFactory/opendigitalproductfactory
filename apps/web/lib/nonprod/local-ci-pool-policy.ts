import pilotGuardrails from "./local-ci-pilot-guardrails.json" with {
  type: "json",
};
import { isRecord as isRecordRuntime } from "../shared/is-record.mjs";

export const LOCAL_CI_POOL_CONFIG_KEY = "local_ci.sandbox_pool";
export const LOCAL_CI_POOL_POLICY_VERSION = 1 as const;
export const LOCAL_CI_MIN_CAPACITY = 1;
export const LOCAL_CI_MAX_CAPACITY = 2;

export type LocalCiPoolPolicySource =
  | "default"
  | "platform-config"
  | "test-env"
  | "break-glass-env";

export type LocalCiHostPressure = {
  observedAt?: string;
  availableMemoryBytes?: number;
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
  env?: PolicyEnv;
  now?: Date;
}): ResolvedLocalCiPoolPolicy {
  const manifestCapacity = Number.isFinite(input.manifestSlotCount)
    && input.manifestSlotCount >= LOCAL_CI_MIN_CAPACITY
    ? Math.min(LOCAL_CI_MAX_CAPACITY, Math.floor(input.manifestSlotCount))
    : LOCAL_CI_MIN_CAPACITY;
  const configError = localCiPoolConfigError(input.configValue);
  if (configError) {
    return singleton({
      source: "default",
      manifestCapacity,
      reason: configError,
    });
  }

  const config = normalizeConfig(input.configValue);
  const override = authorizedCapacityOverride(input.env);
  const requestedCapacity = override?.capacity ?? config.requestedCapacity;
  const source: LocalCiPoolPolicySource = override?.source ?? "platform-config";

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
