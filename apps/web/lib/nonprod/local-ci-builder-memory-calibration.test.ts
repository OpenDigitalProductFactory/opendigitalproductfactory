import { describe, expect, it } from "vitest";

import localCiSlotResources from "./local-ci-slot-resources.json" with { type: "json" };
import {
  BUILDER_CALIBRATION_MIN_SAMPLES,
  BUILDER_CALIBRATION_WINDOW,
  LOCAL_CI_BUILDER_MEMORY_CALIBRATION_KEY,
  builderMemorySampleFromEvidence,
  foldBuilderMemorySample,
  measuredBuilderReserve,
  recordLocalCiBuilderMemorySample,
  type BuilderMemoryCalibration,
} from "./local-ci-builder-memory-calibration";

const GiB = 1024 ** 3;
const CEILING = localCiSlotResources.builderPolicy.memoryBytes;
const CHECKED_IN = localCiSlotResources.builderPolicy.admissionReserveBytes;
const MARGIN = localCiSlotResources.builderPolicy.admissionCalibration.safetyMarginBytes;

function calibration(peaks: number[], overrides: Partial<BuilderMemoryCalibration> = {}): BuilderMemoryCalibration {
  return {
    schemaVersion: 1,
    ceilingBytes: CEILING,
    samples: peaks.map((peakBytes, index) => ({
      peakBytes,
      oomKills: 0,
      observedAt: new Date(Date.UTC(2026, 8, 25, 0, index)).toISOString(),
    })),
    ...overrides,
  };
}

function reserve(value: unknown) {
  return measuredBuilderReserve({
    ceilingBytes: CEILING,
    checkedInReserveBytes: CHECKED_IN,
    safetyMarginBytes: MARGIN,
    calibration: value,
  });
}

// The shape a bounded build writes since BI-D3BF53A9 (#5708).
function gateEvidence(builderMemory: Record<string, unknown> | null) {
  return { controlPlane: { builderMemory } };
}
function measured(peakBytes: number, oomKills = 0) {
  return {
    bi: "BI-D3BF53A9",
    status: "measured",
    peakBytes,
    peakScope: "this-build",
    memoryLimitBytes: CEILING,
    oomKills,
  };
}

describe("measuredBuilderReserve", () => {
  it("AC-3: reproduces the checked-in figure from #5708's own three measured peaks", () => {
    // BI-D3BF53A9 measured 14,853,529,600 / 14,644,989,952 / 14,876,745,728 and
    // checked in highest + margin. Five runs at those peaks give the same answer.
    const peaks = [14_853_529_600, 14_644_989_952, 14_876_745_728, 14_853_529_600, 14_644_989_952];
    const result = reserve(calibration(peaks));
    expect(result).toMatchObject({ source: "measured", sampleCount: 5 });
    expect(result.bytes).toBe(CHECKED_IN);
  });

  it("AC-3: follows the build down when it gets smaller", () => {
    const result = reserve(calibration(Array.from({ length: 6 }, () => 11 * GiB)));
    expect(result.source).toBe("measured");
    expect(result.bytes).toBe(11 * GiB + MARGIN);
    expect(result.bytes).toBeLessThan(CHECKED_IN);
  });

  it("AC-3: follows the build up, never past the hard ceiling", () => {
    const result = reserve(calibration(Array.from({ length: 6 }, () => 15.8 * GiB)));
    expect(result.bytes).toBe(CEILING);
  });

  it("AC-4: fewer than the minimum peaks keeps the checked-in calibration", () => {
    const peaks = Array.from({ length: BUILDER_CALIBRATION_MIN_SAMPLES - 1 }, () => 9 * GiB);
    expect(reserve(calibration(peaks))).toMatchObject({ source: "checked-in", bytes: CHECKED_IN });
  });

  it("AC-4: an OOM kill in the window reserves the ceiling, even before the minimum", () => {
    const value = calibration([9 * GiB, 9 * GiB]);
    value.samples[1] = { ...value.samples[1], oomKills: 1 };
    expect(reserve(value)).toMatchObject({ source: "ceiling", bytes: CEILING });
  });

  it("AC-4: peaks measured under another ceiling keep the checked-in calibration", () => {
    const value = calibration(Array.from({ length: 6 }, () => 9 * GiB), { ceilingBytes: 8 * GiB });
    expect(reserve(value)).toMatchObject({ source: "checked-in", bytes: CHECKED_IN });
  });

  it.each([null, undefined, "x", {}, { schemaVersion: 2, ceilingBytes: CEILING, samples: [] }, { schemaVersion: 1, ceilingBytes: CEILING, samples: [{ peakBytes: -1, oomKills: 0, observedAt: "t" }] }])(
    "AC-4: absent or invalid calibration %# keeps the checked-in calibration",
    (value) => {
      expect(reserve(value)).toMatchObject({ source: "checked-in", bytes: CHECKED_IN });
    },
  );
});

describe("builderMemorySampleFromEvidence", () => {
  it("reads the measurement a bounded build records", () => {
    expect(builderMemorySampleFromEvidence(gateEvidence(measured(14 * GiB)))).toEqual({
      peakBytes: 14 * GiB,
      oomKills: 0,
      ceilingBytes: CEILING,
    });
  });

  it.each([
    undefined,
    {},
    gateEvidence(null),
    gateEvidence({ ...measured(14 * GiB), status: "unmeasured", peakBytes: null }),
    gateEvidence({ ...measured(14 * GiB), oomKills: null }),
    gateEvidence({ ...measured(14 * GiB), memoryLimitBytes: null }),
  ])("AC-2: evidence %# without a usable measurement yields no sample", (evidence) => {
    expect(builderMemorySampleFromEvidence(evidence)).toBeNull();
  });
});

describe("foldBuilderMemorySample", () => {
  const now = new Date("2026-09-25T20:00:00.000Z");

  it("appends to the window and keeps only the newest samples", () => {
    const full = calibration(Array.from({ length: BUILDER_CALIBRATION_WINDOW }, () => 14 * GiB));
    const folded = foldBuilderMemorySample({
      current: full,
      sample: { peakBytes: 13 * GiB, oomKills: 0, ceilingBytes: CEILING },
      now,
    });
    expect(folded.samples).toHaveLength(BUILDER_CALIBRATION_WINDOW);
    expect(folded.samples.at(-1)).toEqual({ peakBytes: 13 * GiB, oomKills: 0, observedAt: now.toISOString() });
    expect(folded.samples[0].observedAt).toBe(full.samples[1].observedAt);
  });

  it("resets the window when the ceiling changes", () => {
    const folded = foldBuilderMemorySample({
      current: calibration([5 * GiB], { ceilingBytes: 8 * GiB }),
      sample: { peakBytes: 13 * GiB, oomKills: 0, ceilingBytes: CEILING },
      now,
    });
    expect(folded.samples).toEqual([{ peakBytes: 13 * GiB, oomKills: 0, observedAt: now.toISOString() }]);
    expect(folded.ceilingBytes).toBe(CEILING);
  });
});

describe("recordLocalCiBuilderMemorySample", () => {
  const now = new Date("2026-09-25T20:00:00.000Z");

  function store(initial: { value: unknown; updatedAt: Date } | null, updateCounts: number[] = [1]) {
    const calls: { updates: unknown[]; creates: unknown[] } = { updates: [], creates: [] };
    let row = initial;
    return {
      calls,
      platformConfig: {
        findUnique: async () => row,
        updateMany: async (args: { data: { value: unknown } }) => {
          calls.updates.push(args);
          const count = updateCounts.shift() ?? 1;
          if (count === 1 && row) row = { value: args.data.value, updatedAt: new Date(row.updatedAt.getTime() + 1) };
          return { count };
        },
        create: async (args: { data: { key: string; value: unknown } }) => {
          calls.creates.push(args);
          row = { value: args.data.value, updatedAt: now };
          return {};
        },
      },
    };
  }

  it("AC-2: creates the calibration row on the first measured run", async () => {
    const { platformConfig, calls } = store(null);
    const result = await recordLocalCiBuilderMemorySample({
      platformConfig,
      evidence: gateEvidence(measured(14 * GiB)),
      now,
    });
    expect(result.status).toBe("recorded");
    expect(calls.creates).toEqual([{
      data: {
        key: LOCAL_CI_BUILDER_MEMORY_CALIBRATION_KEY,
        value: {
          schemaVersion: 1,
          ceilingBytes: CEILING,
          samples: [{ peakBytes: 14 * GiB, oomKills: 0, observedAt: now.toISOString() }],
        },
      },
    }]);
  });

  it("AC-2: folds into the existing row under optimistic concurrency, retrying a lost race", async () => {
    const updatedAt = new Date("2026-09-25T19:00:00.000Z");
    const { platformConfig, calls } = store({ value: calibration([14 * GiB]), updatedAt }, [0, 1]);
    const result = await recordLocalCiBuilderMemorySample({
      platformConfig,
      evidence: gateEvidence(measured(14 * GiB)),
      now,
    });
    expect(result.status).toBe("recorded");
    expect(calls.updates).toHaveLength(2);
    expect(calls.updates[0]).toMatchObject({
      where: { key: LOCAL_CI_BUILDER_MEMORY_CALIBRATION_KEY, updatedAt: { equals: updatedAt } },
    });
  });

  it("AC-2: ignores a run that carried no measurement", async () => {
    const { platformConfig, calls } = store(null);
    const result = await recordLocalCiBuilderMemorySample({
      platformConfig,
      evidence: gateEvidence(null),
      now,
    });
    expect(result.status).toBe("no-sample");
    expect(calls.creates).toHaveLength(0);
  });

  it("gives up after repeated lost races without throwing", async () => {
    const { platformConfig } = store({ value: calibration([14 * GiB]), updatedAt: now }, [0, 0, 0]);
    const result = await recordLocalCiBuilderMemorySample({
      platformConfig,
      evidence: gateEvidence(measured(14 * GiB)),
      now,
    });
    expect(result.status).toBe("concurrent-update-exhausted");
  });
});
