import { describe, expect, it } from "vitest";

import {
  resolveHostResourcePoolPolicy,
  resolveNonprodPoolPolicy,
} from "./environment-lease-pool-policy";

const GiB = 1024 ** 3;

describe("resolveHostResourcePoolPolicy", () => {
  it("projects an admitted request into the existing lease capacity contract", () => {
    expect(resolveHostResourcePoolPolicy({
      resourceClass: "next-build",
      expectedMemoryBytes: 16 * GiB,
      hostResource: {
        totalMemoryBytes: 64 * GiB,
        availableMemoryBytes: 30 * GiB,
        inferenceResident: true,
      },
      activeReservations: [],
    })).toMatchObject({
      policyVersion: 1,
      source: "host-resource-profile",
      effectiveCapacity: 1,
      slotKeys: ["slot-0"],
      rollbackReason: null,
    });
  });

  it("projects a full singleton as zero currently available capacity", () => {
    expect(resolveHostResourcePoolPolicy({
      resourceClass: "vitest",
      expectedMemoryBytes: 8 * GiB,
      hostResource: {
        totalMemoryBytes: 64 * GiB,
        availableMemoryBytes: 24 * GiB,
        inferenceResident: true,
      },
      activeReservations: [{ resourceClass: "next-build", expectedMemoryBytes: 16 * GiB }],
    })).toMatchObject({
      effectiveCapacity: 0,
      slotKeys: [],
      rollbackReason: "inference-resident-singleton",
    });
  });
});

describe("resolveNonprodPoolPolicy decidedHostPressure (BI-48F42581)", () => {
  const platformConfig = {
    findUnique: async () => ({
      value: {
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
    }),
  };

  const now = new Date("2026-09-10T02:00:00.000Z");
  const healthy = {
    observedAt: now.toISOString(),
    diskFreeBytes: 900 * GiB,
    dockerHealthy: true,
    convergenceActive: false,
    fencesHealthy: true,
    evidenceIsolationHealthy: true,
  };

  it("hands back the observation the decision was taken on, not the caller's sample", async () => {
    // The caller's own sample says the host is quiet; the canonical broker sees
    // it saturated. The refusal must travel with the numbers that produced it,
    // or a gate record reads "host-cpu-high" beside 12% CPU and the operator
    // goes looking for a bug in the gate.
    const policy = await resolveNonprodPoolPolicy({
      platformConfig,
      environmentKey: "local-integration-ci",
      manifestSlotCount: 2,
      now,
      hostPressure: {
        ...healthy,
        availableMemoryBytes: 25 * GiB,
        sustainedCpuPercent: 12,
      },
      capacityBroker: async () => ({
        ...healthy,
        availableMemoryBytes: 25 * GiB,
        dockerAvailableMemoryBytes: 25 * GiB,
        builderMemoryUsageBytes: [0, 0],
        sustainedCpuPercent: 97,
      }),
    });

    expect(policy.rollbackReason).toBe("host-cpu-high");
    expect(policy.decidedHostPressure?.sustainedCpuPercent).toBe(97);
  });

  it("carries the merged observation on an open pool too", async () => {
    const policy = await resolveNonprodPoolPolicy({
      platformConfig,
      environmentKey: "local-integration-ci",
      manifestSlotCount: 2,
      now,
      hostPressure: {
        ...healthy,
        availableMemoryBytes: 25 * GiB,
        sustainedCpuPercent: 12,
      },
      capacityBroker: async () => ({
        ...healthy,
        availableMemoryBytes: 25 * GiB,
        dockerAvailableMemoryBytes: 25 * GiB,
        builderMemoryUsageBytes: [0, 0],
        sustainedCpuPercent: 20,
      }),
    });

    expect(policy.rollbackReason).toBeNull();
    // Maximum load wins in the merge, so the recorded figure is the pessimistic one.
    expect(policy.decidedHostPressure?.sustainedCpuPercent).toBe(20);
  });
});
