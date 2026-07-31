export const HOSPITALITY_RESOURCE_KINDS = [
  "table",
  "kitchen-station",
  "oven",
  "delivery-vehicle",
  "service-area",
] as const;
export type HospitalityResourceKind =
  (typeof HOSPITALITY_RESOURCE_KINDS)[number];

export const HOSPITALITY_RESOURCE_STATUSES = [
  "active",
  "blocked",
  "retired",
] as const;
export type HospitalityResourceStatus =
  (typeof HOSPITALITY_RESOURCE_STATUSES)[number];

export const HOSPITALITY_CAPACITY_POOL_KINDS = [
  "kitchen",
  "bake",
  "delivery-window",
  "event-service",
] as const;
export type HospitalityCapacityPoolKind =
  (typeof HOSPITALITY_CAPACITY_POOL_KINDS)[number];

export const HOSPITALITY_CAPACITY_UNITS = [
  "seats",
  "covers",
  "orders",
  "batches",
  "deliveries",
  "events",
] as const;
export type HospitalityCapacityUnit =
  (typeof HOSPITALITY_CAPACITY_UNITS)[number];

export const HOSPITALITY_ALLOCATION_LIFECYCLES = [
  "reserved",
  "active",
  "released",
  "cancelled",
  "quarantined",
] as const;
export type HospitalityAllocationLifecycle =
  (typeof HOSPITALITY_ALLOCATION_LIFECYCLES)[number];

export const HOSPITALITY_DEMAND_TYPES = [
  "booking",
  "hold",
  "event",
  "production-order",
  "delivery",
  "manual",
] as const;
export type HospitalityDemandType =
  (typeof HOSPITALITY_DEMAND_TYPES)[number];

const LIVE_LIFECYCLES = new Set<HospitalityAllocationLifecycle>([
  "reserved",
  "active",
]);
const TERMINAL_LIFECYCLES = new Set<HospitalityAllocationLifecycle>([
  "released",
  "cancelled",
  "quarantined",
]);

export interface HospitalityAllocationFact {
  id: string;
  startsAt: Date;
  endsAt: Date;
  quantity: number;
  lifecycle: HospitalityAllocationLifecycle;
  version: number;
  releasedAt?: Date | null;
  releaseReason?: string | null;
}

export interface HospitalityAllocationRequest {
  startsAt: Date;
  endsAt: Date;
  quantity: number;
  resourceId: string | null;
  poolId: string | null;
}

export interface HospitalityAvailabilityWindow {
  kind: "available" | "blocked";
  days: number[];
  startTime: string | null;
  endTime: string | null;
  date: Date | null;
}

export class HospitalityCapacityConflictError extends Error {
  readonly code = "HOSPITALITY_CAPACITY_CONFLICT";

  constructor(
    message: string,
    readonly detail: {
      capacity: number;
      used: number;
      available: number;
      requested: number;
    },
  ) {
    super(message);
    this.name = "HospitalityCapacityConflictError";
  }
}

export class HospitalityCapacityVersionError extends Error {
  readonly code = "HOSPITALITY_CAPACITY_VERSION_CONFLICT";

  constructor(
    readonly expectedVersion: number,
    readonly actualVersion: number,
  ) {
    super(
      `Hospitality allocation version conflict: expected ${expectedVersion}, actual ${actualVersion}`,
    );
    this.name = "HospitalityCapacityVersionError";
  }
}

export function validateAllocationRequest(
  input: HospitalityAllocationRequest,
): HospitalityAllocationRequest {
  if (
    !(input.startsAt instanceof Date) ||
    !(input.endsAt instanceof Date) ||
    !Number.isFinite(input.startsAt.getTime()) ||
    !Number.isFinite(input.endsAt.getTime())
  ) {
    throw new TypeError("Allocation start and end must be valid dates");
  }
  if (input.endsAt.getTime() <= input.startsAt.getTime()) {
    throw new RangeError("Allocation end must be after start");
  }
  if (!Number.isInteger(input.quantity) || input.quantity <= 0) {
    throw new RangeError("Allocation quantity must be a positive integer");
  }
  if (Boolean(input.resourceId) === Boolean(input.poolId)) {
    throw new TypeError(
      "Allocation must target exactly one hospitality resource or capacity pool",
    );
  }
  return input;
}

function intervalsOverlap(
  leftStart: Date,
  leftEnd: Date,
  rightStart: Date,
  rightEnd: Date,
): boolean {
  return leftStart.getTime() < rightEnd.getTime() &&
    rightStart.getTime() < leftEnd.getTime();
}

function localIntervalPoint(at: Date, timeZone: string): {
  dateKey: string;
  day: number;
  minute: number;
} {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((entry) => entry.type === type)?.value ?? "";
  return {
    dateKey: `${part("year")}-${part("month")}-${part("day")}`,
    day: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(
      part("weekday"),
    ),
    minute: Number(part("hour")) * 60 + Number(part("minute")),
  };
}

function timeToMinutes(value: string | null, fallback: number): number {
  if (value == null) return fallback;
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  if (!match) return Number.NaN;
  return Number(match[1]) * 60 + Number(match[2]);
}

function windowContainsInterval(
  window: HospitalityAvailabilityWindow,
  startMinute: number,
  endMinute: number,
): boolean {
  const windowStart = timeToMinutes(window.startTime, 0);
  const windowEnd = timeToMinutes(window.endTime, 24 * 60);
  return Number.isFinite(windowStart) &&
    Number.isFinite(windowEnd) &&
    startMinute >= windowStart &&
    endMinute <= windowEnd;
}

function windowOverlapsInterval(
  window: HospitalityAvailabilityWindow,
  startMinute: number,
  endMinute: number,
): boolean {
  const windowStart = timeToMinutes(window.startTime, 0);
  const windowEnd = timeToMinutes(window.endTime, 24 * 60);
  return Number.isFinite(windowStart) &&
    Number.isFinite(windowEnd) &&
    startMinute < windowEnd &&
    windowStart < endMinute;
}

/**
 * Evaluates a resource's recurring hours and dated exceptions in the
 * storefront timezone. Empty availability preserves compatibility with
 * resources that have not yet been configured.
 */
export function isHospitalityResourceAvailableForInterval(input: {
  availability: readonly HospitalityAvailabilityWindow[];
  startsAt: Date;
  endsAt: Date;
  timeZone: string;
}): boolean {
  if (input.availability.length === 0) return true;
  if (
    !Number.isFinite(input.startsAt.getTime()) ||
    !Number.isFinite(input.endsAt.getTime()) ||
    input.endsAt.getTime() <= input.startsAt.getTime()
  ) {
    return false;
  }

  const start = localIntervalPoint(input.startsAt, input.timeZone);
  const end = localIntervalPoint(input.endsAt, input.timeZone);
  if (start.dateKey !== end.dateKey) return false;

  const dated = input.availability.filter(
    (window) => window.date?.toISOString().slice(0, 10) === start.dateKey,
  );
  if (
    dated.some(
      (window) =>
        window.kind === "blocked" &&
        windowOverlapsInterval(window, start.minute, end.minute),
    )
  ) {
    return false;
  }
  const datedAvailable = dated.filter(
    (window) => window.kind === "available",
  );
  if (datedAvailable.length > 0) {
    return datedAvailable.some((window) =>
      windowContainsInterval(window, start.minute, end.minute)
    );
  }

  const recurring = input.availability.filter(
    (window) => window.date == null && window.days.includes(start.day),
  );
  if (
    recurring.some(
      (window) =>
        window.kind === "blocked" &&
        windowOverlapsInterval(window, start.minute, end.minute),
    )
  ) {
    return false;
  }
  const recurringAvailable = recurring.filter(
    (window) => window.kind === "available",
  );
  return recurringAvailable.length === 0 ||
    recurringAvailable.some((window) =>
      windowContainsInterval(window, start.minute, end.minute)
    );
}

export function evaluatePoolCapacity(input: {
  capacity: number;
  startsAt: Date;
  endsAt: Date;
  requestedQuantity: number;
  allocations: readonly HospitalityAllocationFact[];
  throwOnConflict?: boolean;
}): {
  used: number;
  available: number;
  requested: number;
  accepted: boolean;
} {
  if (!Number.isInteger(input.capacity) || input.capacity <= 0) {
    throw new RangeError("Pool capacity must be a positive integer");
  }
  if (
    !Number.isInteger(input.requestedQuantity) ||
    input.requestedQuantity <= 0
  ) {
    throw new RangeError("Requested quantity must be a positive integer");
  }
  if (input.endsAt.getTime() <= input.startsAt.getTime()) {
    throw new RangeError("Capacity interval end must be after start");
  }

  const used = input.allocations
    .filter((allocation) => LIVE_LIFECYCLES.has(allocation.lifecycle))
    .filter((allocation) =>
      intervalsOverlap(
        allocation.startsAt,
        allocation.endsAt,
        input.startsAt,
        input.endsAt,
      ),
    )
    .reduce((total, allocation) => total + allocation.quantity, 0);
  const available = Math.max(0, input.capacity - used);
  const accepted = input.requestedQuantity <= available;
  const result = {
    used,
    available,
    requested: input.requestedQuantity,
    accepted,
  };

  if (!accepted && input.throwOnConflict) {
    throw new HospitalityCapacityConflictError(
      `Hospitality capacity conflict: ${input.requestedQuantity} requested, ${available} available`,
      {
        capacity: input.capacity,
        used,
        available,
        requested: input.requestedQuantity,
      },
    );
  }
  return result;
}

const ALLOWED_TRANSITIONS: Record<
  HospitalityAllocationLifecycle,
  readonly HospitalityAllocationLifecycle[]
> = {
  reserved: ["active", "released", "cancelled", "quarantined"],
  active: ["released", "cancelled", "quarantined"],
  released: [],
  cancelled: [],
  quarantined: [],
};

export function transitionHospitalityAllocation(
  current: HospitalityAllocationFact,
  input: {
    expectedVersion: number;
    lifecycle: HospitalityAllocationLifecycle;
    at: Date;
    reason?: string;
  },
): HospitalityAllocationFact {
  if (current.version !== input.expectedVersion) {
    throw new HospitalityCapacityVersionError(
      input.expectedVersion,
      current.version,
    );
  }
  if (TERMINAL_LIFECYCLES.has(current.lifecycle)) {
    throw new Error(
      `Hospitality allocation ${current.id} is terminal (${current.lifecycle})`,
    );
  }
  if (!ALLOWED_TRANSITIONS[current.lifecycle].includes(input.lifecycle)) {
    throw new Error(
      `Invalid hospitality allocation transition ${current.lifecycle} -> ${input.lifecycle}`,
    );
  }

  const terminal = TERMINAL_LIFECYCLES.has(input.lifecycle);
  return {
    ...current,
    lifecycle: input.lifecycle,
    version: current.version + 1,
    releasedAt: terminal ? input.at : null,
    releaseReason: terminal ? (input.reason ?? null) : null,
  };
}
