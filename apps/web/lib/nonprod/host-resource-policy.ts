import profiles from "./host-resource-profiles.json";

export const HEAVY_RESOURCE_CLASSES = Object.keys(profiles.profiles) as [
  "typescript",
  "vitest",
  "next-build",
  "docker-build",
  "preview",
  "inference",
  "semantic-review",
];

export type HeavyResourceClass = (typeof HEAVY_RESOURCE_CLASSES)[number];
export type HostResourceClass = HeavyResourceClass | "cheap-guard" | string;

export const DEFAULT_HEAVY_RESOURCE_PROFILES = Object.freeze(
  Object.fromEntries(
    Object.entries(profiles.profiles).map(([key, value]) => [
      key,
      Object.freeze({ expectedMemoryBytes: value.expectedMemoryMiB * 1024 ** 2 }),
    ]),
  ) as Record<HeavyResourceClass, { expectedMemoryBytes: number }>,
);

export interface ActiveHeavyReservation {
  resourceClass: HeavyResourceClass;
  expectedMemoryBytes: number;
}

export interface HostResourceAdmissionInput {
  resourceClass: HostResourceClass;
  expectedMemoryBytes?: number;
  totalMemoryBytes: number;
  availableMemoryBytes: number;
  activeHeavyReservations: ActiveHeavyReservation[];
  inferenceResident: boolean;
  hostReserveBytes?: number;
  inferenceGrowthReserveBytes?: number;
}

export type HostResourceAdmission =
  | { status: "bypass"; resourceClass: "cheap-guard"; reason: "not-heavyweight" }
  | {
      status: "admitted";
      resourceClass: HeavyResourceClass;
      expectedMemoryBytes: number;
      capacity: number;
      reason: "capacity-available";
    }
  | {
      status: "queued";
      resourceClass: HeavyResourceClass;
      expectedMemoryBytes: number;
      capacity: number;
      reason: "inference-resident-singleton" | "host-memory-reserve" | "heavy-capacity-full";
      retryAfterSeconds: number;
    }
  | {
      status: "blocked";
      resourceClass: string;
      reason:
        | "unknown-resource-class"
        | "host-memory-unmeasurable"
        | "expected-memory-unmeasurable"
        | "expected-memory-below-governed-floor";
    };

function isFinitePositive(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

export function isHeavyResourceClass(value: string): value is HeavyResourceClass {
  return (HEAVY_RESOURCE_CLASSES as readonly string[]).includes(value);
}

/**
 * Pure host-wide admission projection. Available memory is the measured host
 * state; the two reserves are prospective floors kept for the OS and growth of
 * an already-resident local model. A 64 GiB developer host is deliberately a
 * singleton for non-inference heavy work while inference is resident.
 */
export function resolveHostResourceAdmission(
  input: HostResourceAdmissionInput,
): HostResourceAdmission {
  if (input.resourceClass === "cheap-guard") {
    return { status: "bypass", resourceClass: "cheap-guard", reason: "not-heavyweight" };
  }
  if (!isHeavyResourceClass(input.resourceClass)) {
    return { status: "blocked", resourceClass: input.resourceClass, reason: "unknown-resource-class" };
  }
  if (!isFinitePositive(input.totalMemoryBytes) || !Number.isFinite(input.availableMemoryBytes)) {
    return { status: "blocked", resourceClass: input.resourceClass, reason: "host-memory-unmeasurable" };
  }

  const floor = DEFAULT_HEAVY_RESOURCE_PROFILES[input.resourceClass].expectedMemoryBytes;
  const expectedMemoryBytes = input.expectedMemoryBytes ?? floor;
  if (!isFinitePositive(expectedMemoryBytes)) {
    return { status: "blocked", resourceClass: input.resourceClass, reason: "expected-memory-unmeasurable" };
  }
  if (expectedMemoryBytes < floor) {
    return {
      status: "blocked",
      resourceClass: input.resourceClass,
      reason: "expected-memory-below-governed-floor",
    };
  }

  const hostReserveBytes = input.hostReserveBytes ?? profiles.hostReserveMiB * 1024 ** 2;
  const inferenceGrowthReserveBytes = input.inferenceResident
    ? input.inferenceGrowthReserveBytes ?? profiles.inferenceGrowthReserveMiB * 1024 ** 2
    : 0;
  const inferenceSingleton = input.resourceClass === "inference";
  const singletonWhileInferenceResident = input.inferenceResident
    && input.resourceClass !== "inference"
    && input.totalMemoryBytes <= profiles.singletonHostCeilingMiB * 1024 ** 2;
  const capacity = inferenceSingleton || singletonWhileInferenceResident
    ? 1
    : Math.max(1, Math.floor(
        (input.availableMemoryBytes - hostReserveBytes - inferenceGrowthReserveBytes)
        / expectedMemoryBytes,
      ));

  if (input.availableMemoryBytes < expectedMemoryBytes + hostReserveBytes + inferenceGrowthReserveBytes) {
    return {
      status: "queued",
      resourceClass: input.resourceClass,
      expectedMemoryBytes,
      capacity,
      reason: "host-memory-reserve",
      retryAfterSeconds: 30,
    };
  }
  if (input.activeHeavyReservations.length >= capacity) {
    return {
      status: "queued",
      resourceClass: input.resourceClass,
      expectedMemoryBytes,
      capacity,
      reason: singletonWhileInferenceResident
        ? "inference-resident-singleton"
        : "heavy-capacity-full",
      retryAfterSeconds: 30,
    };
  }
  return {
    status: "admitted",
    resourceClass: input.resourceClass,
    expectedMemoryBytes,
    capacity,
    reason: "capacity-available",
  };
}
