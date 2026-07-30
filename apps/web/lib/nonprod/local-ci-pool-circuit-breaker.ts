import type { Prisma } from "@dpf/db";
import {
  LOCAL_CI_POOL_CONFIG_KEY,
  localCiPoolConfigError,
  type LocalCiPoolConfig,
} from "./local-ci-pool-policy";

type LocalCiGateStatus =
  | "passed"
  | "failed"
  | "conflict"
  | "blocked_sandbox_drift";

export type PlatformConfigCircuitBreakerStore = {
  findUnique: (args: {
    where: { key: string };
    select: { value: true; updatedAt: true };
  }) => Promise<{ value: unknown; updatedAt: Date } | null>;
  updateMany: (args: {
    where: { key: string; updatedAt: { equals: Date } };
    data: { value: Prisma.InputJsonValue };
  }) => Promise<{ count: number }>;
};

type CircuitBreakerResult =
  | { status: "not-applicable" }
  | { status: "config-absent" }
  | { status: "config-invalid" }
  | { status: "already-singleton" }
  | { status: "contracted" }
  | { status: "concurrent-update-exhausted" };

function objectValue(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function evidenceSlotKey(evidence: unknown): string | null {
  const root = objectValue(evidence);
  const manifest = objectValue(root?.["slotManifest"]);
  return typeof manifest?.["slotKey"] === "string"
    ? manifest["slotKey"]
    : null;
}

function shouldContract(
  status: LocalCiGateStatus,
  evidence: unknown,
): boolean {
  return status !== "passed" && evidenceSlotKey(evidence) === "slot-1";
}

/**
 * Persist the safest reversible response to a suspect second slot. The
 * updatedAt predicate prevents a stale read from overwriting a concurrent
 * operator policy change; a bounded retry contracts the newest valid value.
 */
export async function contractLocalCiPoolAfterGateResult(input: {
  platformConfig: PlatformConfigCircuitBreakerStore;
  status: LocalCiGateStatus;
  evidence: unknown;
}): Promise<CircuitBreakerResult> {
  if (!shouldContract(input.status, input.evidence)) {
    return { status: "not-applicable" };
  }

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const row = await input.platformConfig.findUnique({
      where: { key: LOCAL_CI_POOL_CONFIG_KEY },
      select: { value: true, updatedAt: true },
    });
    if (!row) return { status: "config-absent" };
    if (localCiPoolConfigError(row.value)) {
      return { status: "config-invalid" };
    }

    const config = row.value as LocalCiPoolConfig;
    if (config.requestedCapacity === 1) {
      return { status: "already-singleton" };
    }
    const result = await input.platformConfig.updateMany({
      where: {
        key: LOCAL_CI_POOL_CONFIG_KEY,
        updatedAt: { equals: row.updatedAt },
      },
      data: {
        value: {
          ...config,
          requestedCapacity: 1,
        } as Prisma.InputJsonValue,
      },
    });
    if (result.count === 1) return { status: "contracted" };
  }
  return { status: "concurrent-update-exhausted" };
}
