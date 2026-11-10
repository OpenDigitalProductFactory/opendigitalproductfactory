import { describe, expect, it, vi } from "vitest";

import {
  lockHostBackedClaimAdmission,
  resolveHostBackedClaimPolicy,
} from "./environment-lease-host-backed-reservation";
import type { ResolvedLocalCiPoolPolicy } from "./local-ci-pool-policy";
import { claimNonprodEnvironmentLease, DEFAULT_LEASE_TTL_MS } from "./environment-lease";
import localCiSlotResources from "./local-ci-slot-resources.json";
import { NOW, admitted, db, lease } from "./__tests__/environment-lease-fixtures";

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

  it("fails closed when local physical-memory total is missing", async () => {
    const policy = localPolicy();
    delete policy.decidedHostPressure?.totalMemoryBytes;
    const result = await resolveHostBackedClaimPolicy({
      environmentKey: "local-integration-ci",
      slotManifestVersion: 1,
      sharedPoolPolicy: policy,
      readActiveReservations: async () => [],
    });
    expect(result.poolPolicy).toMatchObject({
      effectiveCapacity: 0,
      rollbackReason: "host-memory-unmeasurable",
    });
  });

  it("fails closed when available physical memory exceeds the measured total", async () => {
    const policy = localPolicy();
    policy.decidedHostPressure = {
      totalMemoryBytes: 32 * GiB,
      availableMemoryBytes: 39 * GiB,
    };
    const result = await resolveHostBackedClaimPolicy({
      environmentKey: "local-integration-ci",
      slotManifestVersion: 1,
      sharedPoolPolicy: policy,
      readActiveReservations: async () => [],
    });
    expect(result.poolPolicy).toMatchObject({
      effectiveCapacity: 0,
      rollbackReason: "host-memory-inconsistent",
    });
  });

  it("converges a queued exact runner to the current server envelope before activation", async () => {
    const mockDb = db();
    const waiting = lease({
      slotManifestVersion: 1,
      resourceClass: "docker-build",
      expectedMemoryBytes: BigInt(14 * GiB),
    });
    mockDb.platformConfig.findUnique.mockResolvedValue({
      value: {
        version: 1,
        requestedCapacity: 1,
        ceilings: {
          minAvailableMemoryBytes: 8 * GiB,
          maxSustainedCpuPercent: 75,
          minDiskFreeBytes: 100 * GiB,
        },
        rollback: {
          maxServiceDurationRegressionPercent: 15,
          maxInfrastructureFailureRatePercent: 5,
          evidenceMismatchTolerance: 0,
        },
      },
    });
    mockDb.nonProductionEnvironmentLease.findUnique
      .mockResolvedValueOnce(waiting)
      .mockResolvedValueOnce(admitted({
        ...waiting,
        expectedMemoryBytes: BigInt(localCiSlotResources.builderPolicy.admissionReserveBytes),
      }));
    mockDb.nonProductionEnvironmentLease.update.mockResolvedValue(waiting);
    mockDb.nonProductionEnvironmentLease.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([waiting]);
    const hostPressure = {
      observedAt: NOW.toISOString(),
      totalMemoryBytes: 64 * GiB,
      availableMemoryBytes: 40 * GiB,
      sustainedCpuPercent: 20,
      diskFreeBytes: 500 * GiB,
      dockerHealthy: true,
      convergenceActive: false,
      fencesHealthy: true,
      evidenceIsolationHealthy: true,
    };

    await claimNonprodEnvironmentLease({
      db: mockDb as never,
      environmentKey: "local-integration-ci",
      ownerProvider: "codex",
      ownerSessionId: "session-1",
      claimKey: "gate:session-1:sha",
      purpose: "CI",
      url: "http://localhost:3010",
      ports: [3010],
      expiresAt: new Date(NOW.getTime() + DEFAULT_LEASE_TTL_MS),
      now: NOW,
      slotManifestVersion: 1,
      hostPressure,
      capacityBroker: async () => ({
        ...hostPressure,
        availableMemoryBytes: 40 * GiB,
        dockerAvailableMemoryBytes: 40 * GiB,
        builderMemoryUsageBytes: [0, 0],
      }),
    });

    expect(mockDb.nonProductionEnvironmentLease.update).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: { id: waiting.id },
        data: expect.objectContaining({
          resourceClass: "docker-build",
          expectedMemoryBytes: localCiSlotResources.builderPolicy.admissionReserveBytes,
        }),
      }),
    );
  });
});
