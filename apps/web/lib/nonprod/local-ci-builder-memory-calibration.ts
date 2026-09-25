import type { Prisma } from "@dpf/db";

/**
 * Keep the builder admission reserve true without a human re-measuring it
 * (BI-903FB5F9).
 *
 * BI-D3BF53A9 (#5708) measured three builds by hand (13.64–13.86 GiB cgroup
 * memory.peak) and checked in a reserve of highest peak + 1 GiB. It also made
 * every bounded build record its own peak (`controlPlane.builderMemory`). This
 * closes the loop: each leased gate result folds its measured peak into a
 * rolling window in PlatformConfig, and admission applies the same formula to
 * the window, highest measured peak + the checked-in margin. When the build
 * grows or shrinks, the reserve follows it on the next runs. The checked-in
 * calibration stays the answer until the window holds enough measurements.
 *
 * Fail-safe in both directions: an OOM kill anywhere in the window reserves the
 * builder's hard ceiling until it ages out, and a reserve is never above that
 * ceiling. The Kubernetes Vertical Pod Autoscaler sets requests from a window
 * of observed peaks the same way; this uses the window's maximum rather than a
 * percentile because the measured peak sits within about 2 GiB of the limit.
 *
 * Design: docs/superpowers/specs/2026-09-25-platform-owned-local-ci-memory-design.md
 */

export const LOCAL_CI_BUILDER_MEMORY_CALIBRATION_KEY = "local_ci.builder_memory_calibration";
export const BUILDER_CALIBRATION_WINDOW = 20;
export const BUILDER_CALIBRATION_MIN_SAMPLES = 5;

export type BuilderMemorySample = {
  peakBytes: number;
  oomKills: number;
  observedAt: string;
};

export type BuilderMemoryCalibration = {
  schemaVersion: 1;
  ceilingBytes: number;
  samples: BuilderMemorySample[];
};

export type BuilderMemoryObservation = {
  peakBytes: number;
  oomKills: number;
  ceilingBytes: number;
};

export type MeasuredBuilderReserve = {
  bytes: number;
  source: "measured" | "checked-in" | "ceiling";
  reason: string;
  sampleCount: number;
};

function objectValue(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function positiveFinite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function nonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function parseSample(value: unknown): BuilderMemorySample | null {
  const sample = objectValue(value);
  if (
    !sample
    || !positiveFinite(sample.peakBytes)
    || !nonNegativeInteger(sample.oomKills)
    || typeof sample.observedAt !== "string"
  ) {
    return null;
  }
  return {
    peakBytes: sample.peakBytes,
    oomKills: sample.oomKills,
    observedAt: sample.observedAt,
  };
}

/** A calibration row, or null when any part of it is not trustworthy. */
export function parseBuilderMemoryCalibration(value: unknown): BuilderMemoryCalibration | null {
  const row = objectValue(value);
  if (
    !row
    || row.schemaVersion !== 1
    || !positiveFinite(row.ceilingBytes)
    || !Array.isArray(row.samples)
  ) {
    return null;
  }
  const samples = row.samples.map(parseSample);
  if (samples.some((sample) => sample === null)) return null;
  return {
    schemaVersion: 1,
    ceilingBytes: row.ceilingBytes,
    samples: samples as BuilderMemorySample[],
  };
}

/**
 * The reserve admission should apply. `checkedInReserveBytes` is the
 * calibration in local-ci-slot-resources.json; `safetyMarginBytes` is its
 * documented margin.
 */
export function measuredBuilderReserve(input: {
  ceilingBytes: number;
  checkedInReserveBytes: number;
  safetyMarginBytes: number;
  calibration: unknown;
}): MeasuredBuilderReserve {
  const checkedIn = (reason: string, sampleCount = 0): MeasuredBuilderReserve => ({
    bytes: Math.min(input.ceilingBytes, input.checkedInReserveBytes),
    source: "checked-in",
    reason,
    sampleCount,
  });
  const calibration = parseBuilderMemoryCalibration(input.calibration);
  if (!calibration) return checkedIn("no measured builder peaks recorded yet");
  if (calibration.ceilingBytes !== input.ceilingBytes) {
    return checkedIn("measured peaks belong to a different builder ceiling");
  }
  const { samples } = calibration;
  if (samples.some((sample) => sample.oomKills > 0)) {
    return {
      bytes: input.ceilingBytes,
      source: "ceiling",
      reason: "a build in the measurement window was OOM-killed",
      sampleCount: samples.length,
    };
  }
  if (samples.length < BUILDER_CALIBRATION_MIN_SAMPLES) {
    return checkedIn(
      `${samples.length} of ${BUILDER_CALIBRATION_MIN_SAMPLES} builder peaks measured`,
      samples.length,
    );
  }
  const highWater = Math.max(...samples.map((sample) => sample.peakBytes));
  return {
    bytes: Math.min(input.ceilingBytes, highWater + Math.max(0, input.safetyMarginBytes)),
    source: "measured",
    reason: `highest of ${samples.length} measured builder peaks plus the calibration margin`,
    sampleCount: samples.length,
  };
}

/**
 * The measurement a bounded build recorded (`controlPlane.builderMemory`,
 * BI-D3BF53A9). Only a measured peak with a known OOM count counts.
 */
export function builderMemorySampleFromEvidence(evidence: unknown): BuilderMemoryObservation | null {
  const controlPlane = objectValue(objectValue(evidence)?.controlPlane);
  const measured = objectValue(controlPlane?.builderMemory);
  if (
    !measured
    || measured.status !== "measured"
    || !positiveFinite(measured.peakBytes)
    || !nonNegativeInteger(measured.oomKills)
    || !positiveFinite(measured.memoryLimitBytes)
  ) {
    return null;
  }
  return {
    peakBytes: measured.peakBytes,
    oomKills: measured.oomKills,
    ceilingBytes: measured.memoryLimitBytes,
  };
}

export function foldBuilderMemorySample(input: {
  current: unknown;
  sample: BuilderMemoryObservation;
  now: Date;
}): BuilderMemoryCalibration {
  const current = parseBuilderMemoryCalibration(input.current);
  // Peaks measured under another ceiling describe another builder policy.
  const prior = current && current.ceilingBytes === input.sample.ceilingBytes
    ? current.samples
    : [];
  return {
    schemaVersion: 1,
    ceilingBytes: input.sample.ceilingBytes,
    samples: [
      ...prior,
      {
        peakBytes: input.sample.peakBytes,
        oomKills: input.sample.oomKills,
        observedAt: input.now.toISOString(),
      },
    ].slice(-BUILDER_CALIBRATION_WINDOW),
  };
}

export type BuilderCalibrationStore = {
  findUnique: (args: {
    where: { key: string };
    select: { value: true; updatedAt: true };
  }) => Promise<{ value: unknown; updatedAt: Date } | null>;
  updateMany: (args: {
    where: { key: string; updatedAt: { equals: Date } };
    data: { value: Prisma.InputJsonValue };
  }) => Promise<{ count: number }>;
  create: (args: {
    data: { key: string; value: Prisma.InputJsonValue };
  }) => Promise<unknown>;
};

export type BuilderCalibrationRecordResult =
  | { status: "no-sample" }
  | { status: "recorded" }
  | { status: "concurrent-update-exhausted" };

/**
 * Fold one gate run's builder peak into the calibration row. The updatedAt
 * predicate (the capacity circuit breaker's pattern) keeps two concurrent gate
 * results from overwriting each other; a lost race re-reads and retries.
 */
export async function recordLocalCiBuilderMemorySample(input: {
  platformConfig: BuilderCalibrationStore;
  evidence: unknown;
  now: Date;
}): Promise<BuilderCalibrationRecordResult> {
  const sample = builderMemorySampleFromEvidence(input.evidence);
  if (!sample) return { status: "no-sample" };

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const row = await input.platformConfig.findUnique({
      where: { key: LOCAL_CI_BUILDER_MEMORY_CALIBRATION_KEY },
      select: { value: true, updatedAt: true },
    });
    const value = foldBuilderMemorySample({
      current: row?.value ?? null,
      sample,
      now: input.now,
    }) as unknown as Prisma.InputJsonValue;
    if (!row) {
      try {
        await input.platformConfig.create({
          data: { key: LOCAL_CI_BUILDER_MEMORY_CALIBRATION_KEY, value },
        });
        return { status: "recorded" };
      } catch {
        // Another gate created the row first; fold into it on the next pass.
        continue;
      }
    }
    const result = await input.platformConfig.updateMany({
      where: {
        key: LOCAL_CI_BUILDER_MEMORY_CALIBRATION_KEY,
        updatedAt: { equals: row.updatedAt },
      },
      data: { value },
    });
    if (result.count === 1) return { status: "recorded" };
  }
  return { status: "concurrent-update-exhausted" };
}

export async function loadLocalCiBuilderMemoryCalibration(input: {
  platformConfig: {
    findUnique: (args: {
      where: { key: string };
      select: { value: true };
    }) => Promise<{ value: unknown } | null>;
  };
}): Promise<unknown> {
  const row = await input.platformConfig.findUnique({
    where: { key: LOCAL_CI_BUILDER_MEMORY_CALIBRATION_KEY },
    select: { value: true },
  });
  return row?.value ?? null;
}
