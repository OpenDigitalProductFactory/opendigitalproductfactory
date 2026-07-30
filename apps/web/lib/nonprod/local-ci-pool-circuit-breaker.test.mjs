import { expect, it } from "vitest";

import {
  contractLocalCiPoolAfterGateResult,
} from "./local-ci-pool-circuit-breaker";

const CONFIG = {
  version: 1,
  requestedCapacity: 2,
  ceilings: {
    minAvailableMemoryBytes: 8 * 1024 ** 3,
    maxSustainedCpuPercent: 75,
    minDiskFreeBytes: 100 * 1024 ** 3,
  },
  rollback: {
    maxServiceDurationRegressionPercent: 15,
    maxInfrastructureFailureRatePercent: 5,
    evidenceMismatchTolerance: 0,
  },
};

function slotEvidence(slotKey) {
  return { slotManifest: { schemaVersion: 1, slotKey } };
}

it("a failed slot-1 gate contracts capacity while preserving policy", async () => {
  const writes = [];
  const store = {
    findUnique: async () => ({
      value: CONFIG,
      updatedAt: new Date("2026-07-30T08:00:00.000Z"),
    }),
    updateMany: async (args) => {
      writes.push(args);
      return { count: 1 };
    },
  };

  const result = await contractLocalCiPoolAfterGateResult({
    platformConfig: store,
    status: "failed",
    evidence: slotEvidence("slot-1"),
  });

  expect(result.status).toBe("contracted");
  expect(writes).toHaveLength(1);
  expect(writes[0].data.value).toEqual({
    ...CONFIG,
    requestedCapacity: 1,
  });
  expect(writes[0].where.updatedAt).toEqual({
    equals: new Date("2026-07-30T08:00:00.000Z"),
  });
});

it("passed, slot-0, and non-slot evidence cannot trip the breaker", async () => {
  let reads = 0;
  const platformConfig = {
    findUnique: async () => {
      reads += 1;
      return { value: CONFIG, updatedAt: new Date() };
    },
    updateMany: async () => ({ count: 1 }),
  };

  for (const [status, evidence] of [
    ["passed", slotEvidence("slot-1")],
    ["failed", slotEvidence("slot-0")],
    ["blocked_sandbox_drift", {}],
  ]) {
    const result = await contractLocalCiPoolAfterGateResult({
      platformConfig,
      status,
      evidence,
    });
    expect(result.status).toBe("not-applicable");
  }
  expect(reads).toBe(0);
});

it("an optimistic-concurrency miss retries against the latest policy", async () => {
  const newer = {
    ...CONFIG,
    ceilings: {
      ...CONFIG.ceilings,
      minAvailableMemoryBytes: 10 * 1024 ** 3,
    },
  };
  let reads = 0;
  const writes = [];
  const platformConfig = {
    findUnique: async () => {
      reads += 1;
      return {
        value: reads === 1 ? CONFIG : newer,
        updatedAt: new Date(
          reads === 1
            ? "2026-07-30T08:00:00.000Z"
            : "2026-07-30T08:00:01.000Z",
        ),
      };
    },
    updateMany: async (args) => {
      writes.push(args);
      return { count: writes.length === 1 ? 0 : 1 };
    },
  };

  const result = await contractLocalCiPoolAfterGateResult({
    platformConfig,
    status: "blocked_sandbox_drift",
    evidence: slotEvidence("slot-1"),
  });

  expect(result.status).toBe("contracted");
  expect(reads).toBe(2);
  expect(writes).toHaveLength(2);
  expect(writes[1].data.value).toEqual({
    ...newer,
    requestedCapacity: 1,
  });
});

it("missing or malformed policy is already fail-closed and is not overwritten", async () => {
  for (const value of [null, { version: 1, requestedCapacity: 2 }]) {
    let writes = 0;
    const result = await contractLocalCiPoolAfterGateResult({
      platformConfig: {
        findUnique: async () => value === null
          ? null
          : { value, updatedAt: new Date() },
        updateMany: async () => {
          writes += 1;
          return { count: 1 };
        },
      },
      status: "failed",
      evidence: slotEvidence("slot-1"),
    });
    expect(result.status).toBe(
      value === null ? "config-absent" : "config-invalid",
    );
    expect(writes).toBe(0);
  }
});
