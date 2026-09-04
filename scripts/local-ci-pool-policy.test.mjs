import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  LOCAL_CI_POOL_CONFIG_KEY,
  localCiBuildHeadroomCapacity,
  localCiBuilderAdmissionReserveBytes,
  localCiHostStageHeadroomCapacity,
  loadLocalCiPoolConfig,
  resolveLocalCiPoolPolicy,
} from "../apps/web/lib/nonprod/local-ci-pool-policy.ts";

const SAFE_HOST = Object.freeze({
  observedAt: new Date().toISOString(),
  availableMemoryBytes: 24 * 1024 ** 3,
  sustainedCpuPercent: 28,
  diskFreeBytes: 160 * 1024 ** 3,
  dockerHealthy: true,
  convergenceActive: false,
  fencesHealthy: true,
  evidenceIsolationHealthy: true,
});

const PILOT_CONFIG = Object.freeze({
  version: 1,
  requestedCapacity: 2,
  ceilings: {
    minAvailableMemoryBytes: 12 * 1024 ** 3,
    maxSustainedCpuPercent: 70,
    minDiskFreeBytes: 80 * 1024 ** 3,
  },
  rollback: {
    maxServiceDurationRegressionPercent: 15,
    maxInfrastructureFailureRatePercent: 5,
    evidenceMismatchTolerance: 0,
  },
});

const SLOT_RESOURCES = JSON.parse(readFileSync(new URL(
  "../apps/web/lib/nonprod/local-ci-slot-resources.json",
  import.meta.url,
), "utf8"));

test("uses one versioned PlatformConfig key and defaults absent policy to singleton", () => {
  assert.equal(LOCAL_CI_POOL_CONFIG_KEY, "local_ci.sandbox_pool");
  const resolved = resolveLocalCiPoolPolicy({
    configValue: null,
    host: SAFE_HOST,
    manifestSlotCount: 2,
  });

  assert.equal(resolved.effectiveCapacity, 1);
  assert.equal(resolved.source, "default");
  assert.equal(resolved.rollbackReason, "config-absent");
});

test("malformed, unsupported, and excessive config values fail closed", () => {
  for (const configValue of [
    "two",
    { version: 2, requestedCapacity: 2 },
    { ...PILOT_CONFIG, requestedCapacity: 3 },
    { ...PILOT_CONFIG, ceilings: { ...PILOT_CONFIG.ceilings, maxSustainedCpuPercent: 101 } },
    {
      ...PILOT_CONFIG,
      rollback: {
        ...PILOT_CONFIG.rollback,
        maxInfrastructureFailureRatePercent: 6,
      },
    },
    { ...PILOT_CONFIG, unexpectedSecondConfigSource: true },
  ]) {
    const resolved = resolveLocalCiPoolPolicy({
      configValue,
      host: SAFE_HOST,
      manifestSlotCount: 2,
    });
    assert.equal(resolved.effectiveCapacity, 1);
    assert.match(resolved.rollbackReason, /config-/);
  }
});

test("enables slot 1 only when requested, declared, and all host evidence is safe", () => {
  const resolved = resolveLocalCiPoolPolicy({
    configValue: PILOT_CONFIG,
    host: SAFE_HOST,
    manifestSlotCount: 2,
  });

  assert.equal(resolved.requestedCapacity, 2);
  assert.equal(resolved.hostSafeCapacity, 2);
  assert.equal(resolved.effectiveCapacity, 2);
  assert.equal(resolved.rollbackReason, null);
  assert.deepEqual(resolved.slotKeys, ["slot-0", "slot-1"]);
});

test("admission reserves the canonical bounded-build memory above the host safety floor", () => {
  const resolved = resolveLocalCiPoolPolicy({
    configValue: {
      ...PILOT_CONFIG,
      ceilings: {
        ...PILOT_CONFIG.ceilings,
        minAvailableMemoryBytes: 8 * 1024 ** 3,
      },
    },
    host: {
      ...SAFE_HOST,
      availableMemoryBytes: 11 * 1024 ** 3,
      dockerAvailableMemoryBytes: 9 * 1024 ** 3,
      builderMemoryUsageBytes: [0, 0],
    },
    manifestSlotCount: 2,
    reserveAdmissionHeadroom: true,
  });

  assert.equal(resolved.hostSafeCapacity, 0);
  assert.equal(resolved.effectiveCapacity, 0);
  assert.equal(resolved.rollbackReason, "host-build-headroom-low");
  assert.deepEqual(resolved.slotKeys, []);
});

test("admission uses the calibrated build high-water reserve without weakening the builder ceiling", () => {
  const gib = 1024 ** 3;
  const resolved = resolveLocalCiPoolPolicy({
    configValue: {
      ...PILOT_CONFIG,
      requestedCapacity: 1,
      ceilings: {
        ...PILOT_CONFIG.ceilings,
        minAvailableMemoryBytes: 8 * gib,
      },
    },
    host: {
      ...SAFE_HOST,
      availableMemoryBytes: 24 * gib,
      dockerAvailableMemoryBytes: 12 * gib,
      builderMemoryUsageBytes: [0, 0],
    },
    manifestSlotCount: 2,
    reserveAdmissionHeadroom: true,
  });

  assert.equal(resolved.hostSafeCapacity, 1);
  assert.equal(resolved.effectiveCapacity, 1);
  assert.equal(resolved.rollbackReason, "requested-singleton");
  assert.deepEqual(resolved.slotKeys, ["slot-0"]);
});

test("admission reserves the host-native stage envelope above the safety floor", () => {
  const gib = 1024 ** 3;
  const configValue = {
    ...PILOT_CONFIG,
    ceilings: {
      ...PILOT_CONFIG.ceilings,
      minAvailableMemoryBytes: 8 * gib,
    },
  };

  // Expressed against the calibrated host-stage reserve rather than a literal,
  // so recalibrating it (BI-E58B57EC) cannot silently turn a refusal into an
  // admission. floor + reserve - 1 is one byte short of a single stage.
  const stage = SLOT_RESOURCES.hostStagePolicy.admissionReserveBytes;
  for (const availableMemoryBytes of [8 * gib, 8 * gib + stage - 1]) {
    const resolved = resolveLocalCiPoolPolicy({
      configValue,
      host: {
        ...SAFE_HOST,
        availableMemoryBytes,
        dockerAvailableMemoryBytes: 40 * gib,
        builderMemoryUsageBytes: [0, 0],
      },
      manifestSlotCount: 2,
      reserveAdmissionHeadroom: true,
    });

    assert.equal(resolved.hostSafeCapacity, 0);
    assert.equal(resolved.effectiveCapacity, 0);
    assert.equal(resolved.rollbackReason, "host-stage-headroom-low");
    assert.deepEqual(resolved.slotKeys, []);
  }

  const oneSlot = resolveLocalCiPoolPolicy({
    configValue,
    host: {
      ...SAFE_HOST,
      availableMemoryBytes: 8 * gib + stage,
      dockerAvailableMemoryBytes: 40 * gib,
      builderMemoryUsageBytes: [0, 0],
    },
    manifestSlotCount: 2,
    reserveAdmissionHeadroom: true,
  });
  assert.equal(oneSlot.hostSafeCapacity, 1);
  assert.equal(oneSlot.effectiveCapacity, 1);
  assert.equal(oneSlot.rollbackReason, "host-stage-capacity-one");
  assert.deepEqual(oneSlot.slotKeys, ["slot-0"]);

  const twoSlots = resolveLocalCiPoolPolicy({
    configValue,
    host: {
      ...SAFE_HOST,
      availableMemoryBytes: 8 * gib + 2 * stage,
      dockerAvailableMemoryBytes: 40 * gib,
      builderMemoryUsageBytes: [0, 0],
    },
    manifestSlotCount: 2,
    reserveAdmissionHeadroom: true,
  });
  assert.equal(twoSlots.hostSafeCapacity, 2);
  assert.equal(twoSlots.effectiveCapacity, 2);
  assert.equal(twoSlots.rollbackReason, null);
  assert.deepEqual(twoSlots.slotKeys, ["slot-0", "slot-1"]);
});

test("admission contracts to one slot when headroom covers only one bounded build", () => {
  const resolved = resolveLocalCiPoolPolicy({
    configValue: PILOT_CONFIG,
    host: {
      ...SAFE_HOST,
      availableMemoryBytes: 28 * 1024 ** 3,
      dockerAvailableMemoryBytes: 16 * 1024 ** 3,
      builderMemoryUsageBytes: [1.5 * 1024 ** 3, 0],
    },
    manifestSlotCount: 2,
    reserveAdmissionHeadroom: true,
  });

  assert.equal(resolved.hostSafeCapacity, 1);
  assert.equal(resolved.effectiveCapacity, 1);
  assert.equal(resolved.rollbackReason, "host-build-capacity-one");
  assert.deepEqual(resolved.slotKeys, ["slot-0"]);
});

test("execution pressure does not reserve bounded-build memory a second time", () => {
  const resolved = resolveLocalCiPoolPolicy({
    configValue: {
      ...PILOT_CONFIG,
      ceilings: {
        ...PILOT_CONFIG.ceilings,
        minAvailableMemoryBytes: 8 * 1024 ** 3,
      },
    },
    host: {
      ...SAFE_HOST,
      availableMemoryBytes: 11 * 1024 ** 3,
      dockerAvailableMemoryBytes: 5 * 1024 ** 3,
    },
    manifestSlotCount: 2,
    reserveAdmissionHeadroom: false,
  });

  assert.equal(resolved.hostSafeCapacity, 2);
  assert.equal(resolved.effectiveCapacity, 2);
  assert.equal(resolved.rollbackReason, null);
});

test("bounded-build headroom arithmetic fails closed for invalid resource policy", () => {
  const valid = {
    dockerAvailableMemoryBytes: 30.5 * 1024 ** 3,
    builderMemoryBytes: 16 * 1024 ** 3,
    builderMemoryUsageBytes: [1.5 * 1024 ** 3, 0],
    manifestCapacity: 2,
  };

  assert.equal(localCiBuildHeadroomCapacity(valid), 2);
  for (const builderMemoryBytes of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.equal(localCiBuildHeadroomCapacity({
      ...valid,
      builderMemoryBytes,
    }), 0);
  }
  assert.equal(localCiBuildHeadroomCapacity({
    ...valid,
    dockerAvailableMemoryBytes: 11 * 1024 ** 3,
    builderMemoryUsageBytes: [0, 0],
  }), 0);
});

test("builder admission calibration is capped by and falls back to the hard ceiling", () => {
  const gib = 1024 ** 3;
  assert.equal(localCiBuilderAdmissionReserveBytes({
    hardCeilingBytes: 16 * gib,
    calibratedReserveBytes: 10 * gib,
  }), 10 * gib);
  assert.equal(localCiBuilderAdmissionReserveBytes({
    hardCeilingBytes: 16 * gib,
    calibratedReserveBytes: 20 * gib,
  }), 16 * gib);
  assert.equal(localCiBuilderAdmissionReserveBytes({
    hardCeilingBytes: 16 * gib,
    calibratedReserveBytes: Number.NaN,
  }), 16 * gib);
});

test("builder admission calibration declares high-water plus margin below the hard ceiling", () => {
  const builder = SLOT_RESOURCES.builderPolicy;
  const calibration = builder.admissionCalibration;
  assert.equal(
    calibration.observedHighWaterBytes + calibration.safetyMarginBytes,
    builder.admissionReserveBytes,
  );
  assert.ok(builder.admissionReserveBytes < builder.memoryBytes);
});

test("host-stage headroom arithmetic keeps the configured floor unconsumed", () => {
  const gib = 1024 ** 3;
  const valid = {
    availableMemoryBytes: 24 * gib,
    minAvailableMemoryBytes: 8 * gib,
    hostStageMemoryBytes: 8 * gib,
    manifestCapacity: 2,
  };

  assert.equal(localCiHostStageHeadroomCapacity(valid), 2);
  assert.equal(localCiHostStageHeadroomCapacity({
    ...valid,
    availableMemoryBytes: 20 * gib,
  }), 1);
  assert.equal(localCiHostStageHeadroomCapacity({
    ...valid,
    availableMemoryBytes: 15 * gib,
  }), 0);
  for (const hostStageMemoryBytes of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.equal(localCiHostStageHeadroomCapacity({
      ...valid,
      hostStageMemoryBytes,
    }), 0);
  }
});

test("admission intersects Docker and host-stage capacity instead of returning the first partial fit", () => {
  const gib = 1024 ** 3;
  const resolved = resolveLocalCiPoolPolicy({
    configValue: {
      ...PILOT_CONFIG,
      ceilings: {
        ...PILOT_CONFIG.ceilings,
        minAvailableMemoryBytes: 8 * gib,
      },
    },
    host: {
      ...SAFE_HOST,
      // One byte short of a single host-native stage above the floor, from the
      // manifest so recalibration (BI-E58B57EC) cannot make this admit.
      availableMemoryBytes:
        8 * gib + SLOT_RESOURCES.hostStagePolicy.admissionReserveBytes - 1,
      dockerAvailableMemoryBytes: 20 * gib,
      builderMemoryUsageBytes: [0, 0],
    },
    manifestSlotCount: 2,
    reserveAdmissionHeadroom: true,
  });

  assert.equal(resolved.hostSafeCapacity, 0);
  assert.equal(resolved.effectiveCapacity, 0);
  assert.equal(resolved.rollbackReason, "host-stage-headroom-low");
  assert.deepEqual(resolved.slotKeys, []);
});

test("unmeasurable or unsafe configured host evidence contracts admission to zero", () => {
  const scenarios = [
    [{ ...SAFE_HOST, observedAt: undefined }, "host-observation-unmeasurable"],
    [{ ...SAFE_HOST, availableMemoryBytes: undefined }, "host-memory-unmeasurable"],
    [{ ...SAFE_HOST, observedAt: "2026-01-01T00:00:00.000Z" }, "host-observation-stale"],
    [{ ...SAFE_HOST, availableMemoryBytes: 4 * 1024 ** 3 }, "host-memory-low"],
    [{ ...SAFE_HOST, sustainedCpuPercent: undefined }, "host-cpu-unmeasurable"],
    [{ ...SAFE_HOST, sustainedCpuPercent: 88 }, "host-cpu-high"],
    [{ ...SAFE_HOST, diskFreeBytes: undefined }, "host-disk-unmeasurable"],
    [{ ...SAFE_HOST, diskFreeBytes: 20 * 1024 ** 3 }, "host-disk-low"],
    [{ ...SAFE_HOST, dockerHealthy: false }, "docker-unhealthy"],
    [{ ...SAFE_HOST, convergenceActive: true }, "dependency-convergence-active"],
    [{ ...SAFE_HOST, fencesHealthy: false }, "slot-fence-unhealthy"],
    [{ ...SAFE_HOST, evidenceIsolationHealthy: false }, "evidence-isolation-unproven"],
  ];

  for (const [host, rollbackReason] of scenarios) {
    const resolved = resolveLocalCiPoolPolicy({
      configValue: PILOT_CONFIG,
      host,
      manifestSlotCount: 2,
    });
    assert.equal(resolved.hostSafeCapacity, 0);
    assert.equal(resolved.effectiveCapacity, 0);
    assert.equal(resolved.rollbackReason, rollbackReason);
    assert.deepEqual(resolved.slotKeys, []);
  }
});

test("a valid requested-singleton policy still defers all work under unsafe pressure", () => {
  const resolved = resolveLocalCiPoolPolicy({
    configValue: { ...PILOT_CONFIG, requestedCapacity: 1 },
    host: { ...SAFE_HOST, availableMemoryBytes: 2 * 1024 ** 3 },
    manifestSlotCount: 2,
  });

  assert.equal(resolved.requestedCapacity, 1);
  assert.equal(resolved.hostSafeCapacity, 0);
  assert.equal(resolved.effectiveCapacity, 0);
  assert.equal(resolved.rollbackReason, "host-memory-low");
  assert.deepEqual(resolved.slotKeys, []);
});

test("manifest capacity and requested singleton are hard upper bounds", () => {
  assert.equal(resolveLocalCiPoolPolicy({
    configValue: PILOT_CONFIG,
    host: SAFE_HOST,
    manifestSlotCount: 1,
  }).effectiveCapacity, 1);

  const singleton = resolveLocalCiPoolPolicy({
    configValue: { ...PILOT_CONFIG, requestedCapacity: 1 },
    host: SAFE_HOST,
    manifestSlotCount: 2,
  });
  assert.equal(singleton.effectiveCapacity, 1);
  assert.equal(singleton.rollbackReason, "requested-singleton");

  for (const manifestSlotCount of [Number.NaN, Number.POSITIVE_INFINITY, 0, -1]) {
    const invalidManifest = resolveLocalCiPoolPolicy({
      configValue: PILOT_CONFIG,
      host: SAFE_HOST,
      manifestSlotCount,
    });
    assert.equal(invalidManifest.effectiveCapacity, 1);
    assert.equal(invalidManifest.manifestCapacity, 1);
  }
});

test("environment capacity overrides are limited to tests or explicit break glass", () => {
  const productionIgnored = resolveLocalCiPoolPolicy({
    configValue: null,
    host: SAFE_HOST,
    manifestSlotCount: 2,
    env: {
      NODE_ENV: "production",
      DPF_LOCAL_CI_POOL_CAPACITY: "2",
    },
  });
  assert.equal(productionIgnored.effectiveCapacity, 1);
  assert.equal(productionIgnored.source, "default");

  const testOverride = resolveLocalCiPoolPolicy({
    configValue: PILOT_CONFIG,
    host: SAFE_HOST,
    manifestSlotCount: 2,
    env: {
      NODE_ENV: "test",
      DPF_LOCAL_CI_POOL_CAPACITY: "1",
    },
  });
  assert.equal(testOverride.effectiveCapacity, 1);
  assert.equal(testOverride.source, "test-env");

  const breakGlass = resolveLocalCiPoolPolicy({
    configValue: PILOT_CONFIG,
    host: SAFE_HOST,
    manifestSlotCount: 2,
    env: {
      NODE_ENV: "production",
      DPF_LOCAL_CI_POOL_BREAK_GLASS: "1",
      DPF_LOCAL_CI_POOL_CAPACITY: "1",
    },
  });
  assert.equal(breakGlass.effectiveCapacity, 1);
  assert.equal(breakGlass.source, "break-glass-env");
});

test("loads the policy through the existing PlatformConfig substrate", async () => {
  const calls = [];
  const value = { ...PILOT_CONFIG };
  const loaded = await loadLocalCiPoolConfig({
    platformConfig: {
      findUnique: async (args) => {
        calls.push(args);
        return { value };
      },
    },
  });

  assert.deepEqual(calls, [{
    where: { key: LOCAL_CI_POOL_CONFIG_KEY },
    select: { value: true },
  }]);
  assert.equal(loaded, value);
});
