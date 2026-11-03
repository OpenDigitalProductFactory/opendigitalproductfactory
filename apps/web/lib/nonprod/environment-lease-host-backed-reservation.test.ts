import { describe, expect, it, vi } from "vitest";

import {
  lockHostBackedClaimAdmission,
  resolveHostBackedClaimPolicy,
} from "./environment-lease-host-backed-reservation";
import type { ResolvedLocalCiPoolPolicy } from "./local-ci-pool-policy";

const GiB = 1024 ** 3;

function localPolicy(): ResolvedLocalCiPoolPolicy {
  return {
    policyVersion: 1,
    source: "platform-config",
    requestedCapacity: 2,
    manifestCapacity: 2,
    hostSafeCapacity: 2,
    effectiveCapacity: 2,
    slotKeys: ["slot-0", "slot-1"],
    rollbackReason: null,
    config: {
      version: 1,
      requestedCapacity: 2,
      ceilings: {
        minAvailableMemoryBytes: 4 * GiB,
        maxSustainedCpuPercent: 85,
        minDiskFreeBytes: 50 * GiB,
      },
      rollback: {
        maxServiceDurationRegressionPercent: 15,
        maxInfrastructureFailureRatePercent: 5,
        evidenceMismatchTolerance: 0,
      },
    },
    decidedHostPressure: {
      totalMemoryBytes: 64 * GiB,
      availableMemoryBytes: 39 * GiB,
    },
    hostReservation: {
      resourceClass: "docker-build",
      expectedMemoryBytes: 16 * GiB,
      remainingGrowthReserveBytes: 15_042_142_208,
      builderReserveBytes: 15_950_487_552,
      hostStageReserveBytes: 6 * GiB,
    },
  };
}

describe("host-backed lease reservation", () => {
  it("takes the shared lock before the local-CI FIFO lock", async () => {
    const order: string[] = [];
    await lockHostBackedClaimAdmission({
      environmentKey: "local-integration-ci",
      lock: async (environmentKey) => { order.push(environmentKey); },
    });
    expect(order).toEqual(["host-heavy-resource", "local-integration-ci"]);
  });

  it("queues local-CI behind an active host-heavy byte reservation", async () => {
    const readActiveReservations = vi.fn().mockResolvedValue([{
      resourceClass: "docker-build",
      expectedMemoryBytes: BigInt(16 * GiB),
    }]);
    const result = await resolveHostBackedClaimPolicy({
      environmentKey: "local-integration-ci",
      slotManifestVersion: 1,
      sharedPoolPolicy: localPolicy(),
      readActiveReservations,
    });
    expect(result.poolPolicy).toMatchObject({
      effectiveCapacity: 0,
      rollbackReason: "host-memory-reserve",
    });
    expect(readActiveReservations).toHaveBeenCalledOnce();
  });

  it("does not re-admit or double-charge an active holder", async () => {
    const readActiveReservations = vi.fn();
    const result = await resolveHostBackedClaimPolicy({
      environmentKey: "local-integration-ci",
      slotManifestVersion: 1,
      sharedPoolPolicy: localPolicy(),
      currentLeaseStatus: "active",
      readActiveReservations,
    });
    expect(result.poolPolicy.effectiveCapacity).toBe(2);
    expect(readActiveReservations).not.toHaveBeenCalled();
  });
});
