import { describe, expect, it } from "vitest";

import {
  HOST_REMAINING_GROWTH_CALIBRATION_WINDOW,
  LOCAL_CI_HOST_REMAINING_GROWTH_CALIBRATION_KEY,
  foldHostRemainingGrowthSample,
  hostRemainingGrowthSampleFromEvidence,
  measuredHostRemainingGrowthReserve,
  recordLocalCiHostRemainingGrowthSample,
} from "./local-ci-host-remaining-growth-calibration";

const GiB = 1024 ** 3;
const CHECKED_IN = 15_042_142_208;
const MARGIN = 1 * GiB;

function evidence(admission: number, minimum: number) {
  return {
    admissionPoolPolicy: {
      decidedHostPressure: { totalMemoryBytes: 64 * GiB, availableMemoryBytes: admission },
      config: { ceilings: { minAvailableMemoryBytes: 4 * GiB } },
    },
    hostPressure: { minimumAvailableMemoryBytes: minimum },
  };
}

describe("hostRemainingGrowthSampleFromEvidence", () => {
  it("extracts one internally consistent host drawdown", () => {
    expect(hostRemainingGrowthSampleFromEvidence(evidence(15_654_436_864, 1_686_036_480)))
      .toEqual({
        hostTotalBytes: 64 * GiB,
        admissionAvailableBytes: 15_654_436_864,
        minimumAvailableBytes: 1_686_036_480,
        drawdownBytes: 13_968_400_384,
        hostMemoryFence: 4 * GiB,
      });
  });

  it.each([
    null,
    {},
    evidence(10, 11),
    { ...evidence(10, 1), hostPressure: {} },
    {
      ...evidence(2 * GiB, 1 * GiB),
      admissionPoolPolicy: {
        ...evidence(2 * GiB, 1 * GiB).admissionPoolPolicy,
        decidedHostPressure: { totalMemoryBytes: 2 * GiB, availableMemoryBytes: 2 * GiB },
      },
    },
  ])("rejects incomplete or contradictory evidence %#", (value) => {
    expect(hostRemainingGrowthSampleFromEvidence(value)).toBeNull();
  });
});

describe("measuredHostRemainingGrowthReserve", () => {
  it("is raise-only relative to the checked-in reserve", () => {
    expect(measuredHostRemainingGrowthReserve({
      checkedInReserveBytes: CHECKED_IN,
      safetyMarginBytes: MARGIN,
      calibration: {
        schemaVersion: 1,
        samples: [{
          hostTotalBytes: 64 * GiB,
          admissionAvailableBytes: 12 * GiB,
          minimumAvailableBytes: 8 * GiB,
          drawdownBytes: 4 * GiB,
          hostMemoryFence: 4 * GiB,
          observedAt: "2026-11-03T00:00:00.000Z",
        }],
      },
    }).bytes).toBe(CHECKED_IN);
  });

  it("raises to the largest measured drawdown plus margin", () => {
    const result = measuredHostRemainingGrowthReserve({
      checkedInReserveBytes: CHECKED_IN,
      safetyMarginBytes: MARGIN,
      calibration: {
        schemaVersion: 1,
        samples: [{
          hostTotalBytes: 64 * GiB,
          admissionAvailableBytes: 20 * GiB,
          minimumAvailableBytes: 4 * GiB,
          drawdownBytes: 16 * GiB,
          hostMemoryFence: 4 * GiB,
          observedAt: "2026-11-03T00:00:00.000Z",
        }],
      },
    });
    expect(result.bytes).toBe(17 * GiB);
    expect(result.source).toBe("measured");
  });
});

describe("foldHostRemainingGrowthSample", () => {
  it("keeps only the newest bounded window", () => {
    const current = {
      schemaVersion: 1 as const,
      samples: Array.from({ length: HOST_REMAINING_GROWTH_CALIBRATION_WINDOW }, (_, index) => ({
        hostTotalBytes: 64 * GiB,
        admissionAvailableBytes: 12 * GiB,
        minimumAvailableBytes: 8 * GiB,
        drawdownBytes: 4 * GiB,
        hostMemoryFence: 4 * GiB,
        observedAt: new Date(Date.UTC(2026, 10, 1, 0, index)).toISOString(),
      })),
    };
    const now = new Date("2026-11-03T00:00:00.000Z");
    const folded = foldHostRemainingGrowthSample({
      current,
      sample: hostRemainingGrowthSampleFromEvidence(evidence(12 * GiB, 7 * GiB))!,
      now,
    });
    expect(folded.samples).toHaveLength(HOST_REMAINING_GROWTH_CALIBRATION_WINDOW);
    expect(folded.samples.at(-1)?.observedAt).toBe(now.toISOString());
  });

  it("never lowers the historical high-water when old samples age out", () => {
    const current = {
      schemaVersion: 1 as const,
      highWaterDrawdownBytes: 16 * GiB,
      samples: Array.from({ length: HOST_REMAINING_GROWTH_CALIBRATION_WINDOW }, (_, index) => ({
        hostTotalBytes: 64 * GiB,
        admissionAvailableBytes: 12 * GiB,
        minimumAvailableBytes: 8 * GiB,
        drawdownBytes: 4 * GiB,
        hostMemoryFence: 4 * GiB,
        observedAt: new Date(Date.UTC(2026, 10, 1, 0, index)).toISOString(),
      })),
    };
    const folded = foldHostRemainingGrowthSample({
      current,
      sample: hostRemainingGrowthSampleFromEvidence(evidence(12 * GiB, 7 * GiB))!,
      now: new Date("2026-11-03T00:00:00.000Z"),
    });
    expect(folded.highWaterDrawdownBytes).toBe(16 * GiB);
    expect(measuredHostRemainingGrowthReserve({
      checkedInReserveBytes: CHECKED_IN,
      safetyMarginBytes: MARGIN,
      calibration: folded,
    }).bytes).toBe(17 * GiB);
  });
});

describe("recordLocalCiHostRemainingGrowthSample", () => {
  it("creates the calibration row for the first valid leased result", async () => {
    const creates: unknown[] = [];
    const result = await recordLocalCiHostRemainingGrowthSample({
      platformConfig: {
        findUnique: async () => null,
        updateMany: async () => ({ count: 0 }),
        create: async (args) => { creates.push(args); return {}; },
      },
      evidence: evidence(12 * GiB, 7 * GiB),
      now: new Date("2026-11-03T00:00:00.000Z"),
    });
    expect(result.status).toBe("recorded");
    expect(creates).toEqual([expect.objectContaining({
      data: expect.objectContaining({ key: LOCAL_CI_HOST_REMAINING_GROWTH_CALIBRATION_KEY }),
    })]);
  });
});
