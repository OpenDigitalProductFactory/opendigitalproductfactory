import type { Prisma } from "@dpf/db";

export const LOCAL_CI_HOST_REMAINING_GROWTH_CALIBRATION_KEY =
  "local_ci.host_remaining_growth_calibration";
export const HOST_REMAINING_GROWTH_CALIBRATION_WINDOW = 20;

export type HostRemainingGrowthObservation = {
  hostTotalBytes: number;
  admissionAvailableBytes: number;
  minimumAvailableBytes: number;
  drawdownBytes: number;
  hostMemoryFence: number;
};

export type HostRemainingGrowthSample = HostRemainingGrowthObservation & {
  observedAt: string;
};

export type HostRemainingGrowthCalibration = {
  schemaVersion: 1;
  samples: HostRemainingGrowthSample[];
};

export type MeasuredHostRemainingGrowthReserve = {
  bytes: number;
  source: "checked-in" | "measured";
  reason: string;
  sampleCount: number;
};

function objectValue(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function finiteNonnegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function parseObservation(value: unknown): HostRemainingGrowthObservation | null {
  const sample = objectValue(value);
  if (!sample
    || !finiteNonnegative(sample.hostTotalBytes) || sample.hostTotalBytes === 0
    || !finiteNonnegative(sample.admissionAvailableBytes)
    || !finiteNonnegative(sample.minimumAvailableBytes)
    || !finiteNonnegative(sample.drawdownBytes)
    || !finiteNonnegative(sample.hostMemoryFence)
    || sample.admissionAvailableBytes > sample.hostTotalBytes
    || sample.minimumAvailableBytes > sample.admissionAvailableBytes
    || sample.drawdownBytes !== sample.admissionAvailableBytes - sample.minimumAvailableBytes) {
    return null;
  }
  return {
    hostTotalBytes: sample.hostTotalBytes,
    admissionAvailableBytes: sample.admissionAvailableBytes,
    minimumAvailableBytes: sample.minimumAvailableBytes,
    drawdownBytes: sample.drawdownBytes,
    hostMemoryFence: sample.hostMemoryFence,
  };
}

function parseSample(value: unknown): HostRemainingGrowthSample | null {
  const sample = objectValue(value);
  const observation = parseObservation(sample);
  if (!observation || typeof sample?.observedAt !== "string") return null;
  return { ...observation, observedAt: sample.observedAt };
}

export function parseHostRemainingGrowthCalibration(
  value: unknown,
): HostRemainingGrowthCalibration | null {
  const row = objectValue(value);
  if (!row || row.schemaVersion !== 1 || !Array.isArray(row.samples)) return null;
  const samples = row.samples.map(parseSample);
  if (samples.some((sample) => sample === null)) return null;
  return { schemaVersion: 1, samples: samples as HostRemainingGrowthSample[] };
}

export function hostRemainingGrowthSampleFromEvidence(
  evidence: unknown,
): HostRemainingGrowthObservation | null {
  const root = objectValue(evidence);
  const admission = objectValue(root?.admissionPoolPolicy);
  const decidedHost = objectValue(admission?.decidedHostPressure);
  const config = objectValue(admission?.config);
  const ceilings = objectValue(config?.ceilings);
  const summary = objectValue(root?.hostPressure);
  const hostTotalBytes = decidedHost?.totalMemoryBytes;
  const admissionAvailableBytes = decidedHost?.availableMemoryBytes;
  const minimumAvailableBytes = summary?.minimumAvailableMemoryBytes;
  const hostMemoryFence = ceilings?.minAvailableMemoryBytes;
  if (!finiteNonnegative(admissionAvailableBytes)
    || !finiteNonnegative(minimumAvailableBytes)) return null;
  return parseObservation({
    hostTotalBytes,
    admissionAvailableBytes,
    minimumAvailableBytes,
    drawdownBytes: admissionAvailableBytes - minimumAvailableBytes,
    hostMemoryFence,
  });
}

export function measuredHostRemainingGrowthReserve(input: {
  checkedInReserveBytes: number;
  safetyMarginBytes: number;
  calibration: unknown;
}): MeasuredHostRemainingGrowthReserve {
  const calibration = parseHostRemainingGrowthCalibration(input.calibration);
  if (!calibration || calibration.samples.length === 0) {
    return {
      bytes: input.checkedInReserveBytes,
      source: "checked-in",
      reason: "no valid host drawdown samples recorded yet",
      sampleCount: 0,
    };
  }
  const measured = Math.max(...calibration.samples.map(({ drawdownBytes }) => drawdownBytes))
    + Math.max(0, input.safetyMarginBytes);
  if (measured <= input.checkedInReserveBytes) {
    return {
      bytes: input.checkedInReserveBytes,
      source: "checked-in",
      reason: "measured drawdowns do not exceed the checked-in reserve",
      sampleCount: calibration.samples.length,
    };
  }
  return {
    bytes: measured,
    source: "measured",
    reason: "largest measured host drawdown plus the calibration margin",
    sampleCount: calibration.samples.length,
  };
}

export function foldHostRemainingGrowthSample(input: {
  current: unknown;
  sample: HostRemainingGrowthObservation;
  now: Date;
}): HostRemainingGrowthCalibration {
  const prior = parseHostRemainingGrowthCalibration(input.current)?.samples ?? [];
  return {
    schemaVersion: 1,
    samples: [
      ...prior,
      { ...input.sample, observedAt: input.now.toISOString() },
    ].slice(-HOST_REMAINING_GROWTH_CALIBRATION_WINDOW),
  };
}

export type HostRemainingGrowthCalibrationStore = {
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

export async function recordLocalCiHostRemainingGrowthSample(input: {
  platformConfig: HostRemainingGrowthCalibrationStore;
  evidence: unknown;
  now: Date;
}): Promise<{ status: "no-sample" | "recorded" | "concurrent-update-exhausted" }> {
  const sample = hostRemainingGrowthSampleFromEvidence(input.evidence);
  if (!sample) return { status: "no-sample" };
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const row = await input.platformConfig.findUnique({
      where: { key: LOCAL_CI_HOST_REMAINING_GROWTH_CALIBRATION_KEY },
      select: { value: true, updatedAt: true },
    });
    const value = foldHostRemainingGrowthSample({
      current: row?.value ?? null,
      sample,
      now: input.now,
    }) as unknown as Prisma.InputJsonValue;
    if (!row) {
      try {
        await input.platformConfig.create({
          data: { key: LOCAL_CI_HOST_REMAINING_GROWTH_CALIBRATION_KEY, value },
        });
        return { status: "recorded" };
      } catch {
        continue;
      }
    }
    const updated = await input.platformConfig.updateMany({
      where: {
        key: LOCAL_CI_HOST_REMAINING_GROWTH_CALIBRATION_KEY,
        updatedAt: { equals: row.updatedAt },
      },
      data: { value },
    });
    if (updated.count === 1) return { status: "recorded" };
  }
  return { status: "concurrent-update-exhausted" };
}

export async function loadLocalCiHostRemainingGrowthCalibration(input: {
  platformConfig: {
    findUnique: (args: {
      where: { key: string };
      select: { value: true };
    }) => Promise<{ value: unknown } | null>;
  };
}): Promise<unknown> {
  const row = await input.platformConfig.findUnique({
    where: { key: LOCAL_CI_HOST_REMAINING_GROWTH_CALIBRATION_KEY },
    select: { value: true },
  });
  return row?.value ?? null;
}
