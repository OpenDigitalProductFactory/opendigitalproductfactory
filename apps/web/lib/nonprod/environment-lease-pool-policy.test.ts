import { describe, expect, it } from "vitest";

import {
  resolveHostResourcePoolPolicy,
  resolveNonprodPoolPolicy,
} from "./environment-lease-pool-policy";

const GiB = 1024 ** 3;

describe("host admission keeps its kind (BI-C77D920A)", () => {
  const host = { totalMemoryBytes: 64 * GiB, availableMemoryBytes: 24 * GiB, inferenceResident: true };

  it("tells a queued wait apart from a permanent block, though both have zero capacity", () => {
    const queued = resolveHostResourcePoolPolicy({
      resourceClass: "vitest",
      expectedMemoryBytes: 8 * GiB,
      hostResource: host,
      activeReservations: [{ resourceClass: "next-build", expectedMemoryBytes: 16 * GiB }],
    });
    const blocked = resolveHostResourcePoolPolicy({
      resourceClass: "next-build",
      expectedMemoryBytes: 8 * GiB,
      hostResource: { ...host, availableMemoryBytes: Number.NaN },
      activeReservations: [],
    });

    // Both collapse to no capacity — that part was never wrong.
    expect(queued.effectiveCapacity).toBe(0);
    expect(blocked.effectiveCapacity).toBe(0);

    // What was lost: "wait, capacity frees" vs "this will never be admitted".
    expect(queued.admissionStatus).toBe("queued");
    expect(queued.disposition).toBe("awaiting-person");
    expect(blocked.admissionStatus).toBe("blocked");
    expect(blocked.disposition).toBe("refused");
  });

  it("carries proceed for an admitted claim", () => {
    const admitted = resolveHostResourcePoolPolicy({
      resourceClass: "next-build",
      expectedMemoryBytes: 16 * GiB,
      hostResource: { ...host, availableMemoryBytes: 30 * GiB },
      activeReservations: [],
    });
    expect(admitted.admissionStatus).toBe("admitted");
    expect(admitted.disposition).toBe("proceed");
  });
});

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

describe("resolveNonprodPoolPolicy measured builder reserve (BI-903FB5F9)", () => {
  const now = new Date("2026-09-24T03:03:52.775Z");
  const poolConfig = {
    version: 1,
    requestedCapacity: 1,
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
  };
  const calibration = {
    schemaVersion: 1,
    ceilingBytes: 16 * GiB,
    samples: Array.from({ length: 6 }, (_, index) => ({
      peakBytes: 7 * GiB,
      oomKills: 0,
      observedAt: new Date(Date.UTC(2026, 8, 23, 0, index)).toISOString(),
    })),
  };
  // The recorded 2026-09-24 closure: VM 19.89 GiB available, Windows 34.64 GiB.
  const pressure = {
    observedAt: now.toISOString(),
    availableMemoryBytes: 34.64 * GiB,
    dockerAvailableMemoryBytes: 19.89 * GiB,
    builderMemoryUsageBytes: [0, 0],
    sustainedCpuPercent: 20,
    diskFreeBytes: 900 * GiB,
    dockerHealthy: true,
    convergenceActive: false,
    fencesHealthy: true,
    evidenceIsolationHealthy: true,
  };

  function store(rows: Record<string, unknown>) {
    return {
      findUnique: async ({ where }: { where: { key: string } }) =>
        where.key in rows ? { value: rows[where.key] } : null,
    };
  }

  async function decide(rows: Record<string, unknown>) {
    return resolveNonprodPoolPolicy({
      platformConfig: store(rows),
      environmentKey: "local-integration-ci",
      manifestSlotCount: 2,
      reserveAdmissionHeadroom: true,
      now,
      hostPressure: pressure,
      // The portal reads the Docker VM, so its available figure is the VM's.
      capacityBroker: async () => ({ ...pressure, availableMemoryBytes: 19.89 * GiB }),
    });
  }

  it("AC-5: admits on the reserve derived from measured peaks in PlatformConfig", async () => {
    const policy = await decide({
      "local_ci.sandbox_pool": poolConfig,
      "local_ci.builder_memory_calibration": calibration,
    });
    expect(policy.effectiveCapacity).toBe(1);
    expect(policy.builderReserve).toMatchObject({ source: "measured", sampleCount: 6, bytes: 8 * GiB });
  });

  it("AC-4: with no calibration row the checked-in calibration applies", async () => {
    const policy = await decide({ "local_ci.sandbox_pool": poolConfig });
    expect(policy.builderReserve).toMatchObject({ source: "checked-in", sampleCount: 0 });
  });

  it("AC-4: an OOM kill in the window reserves the ceiling and closes this host", async () => {
    const withOom = {
      ...calibration,
      samples: calibration.samples.map((sample, index) => (index === 2 ? { ...sample, oomKills: 1 } : sample)),
    };
    const policy = await decide({
      "local_ci.sandbox_pool": poolConfig,
      "local_ci.builder_memory_calibration": withOom,
    });
    expect(policy.rollbackReason).toBe("host-build-headroom-low");
    expect(policy.builderReserve).toMatchObject({ source: "ceiling", bytes: 16 * GiB });
  });
});
