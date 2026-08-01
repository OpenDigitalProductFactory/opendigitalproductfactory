import {
  parseRestaurantTableAttributes,
  type RestaurantTableShape,
} from "../storefront/restaurant-table-attributes";

export const RESTAURANT_FLOOR_STATES = [
  "available",
  "held",
  "reserved",
  "seated",
  "ordered",
  "paid",
  "dirty",
  "blocked",
  "late-turn",
] as const;

export type RestaurantFloorState = (typeof RESTAURANT_FLOOR_STATES)[number];

export interface RestaurantFloorTableInput {
  id: string;
  label: string;
  capacity: number;
  serviceArea: string | null;
  status: string;
  blockedReason?: string | null;
  attributes?: unknown;
}

export type RestaurantOccupancyStage =
  | "reserved"
  | "seated"
  | "ordered"
  | "paid"
  | "dirty";

export interface RestaurantOccupancyInput {
  tableIds: string[];
  demandId: string;
  stage: RestaurantOccupancyStage;
  turn?: {
    id: string;
    turnId: string;
    version: number;
  };
  startedAt: Date;
  expectedEndAt: Date;
}

export interface RestaurantHoldInput {
  tableId: string;
  startsAt: Date;
  endsAt: Date;
}

export interface RestaurantUpcomingAssignmentInput {
  tableId: string;
  demandId: string;
  startsAt: Date;
  endsAt: Date;
}

export interface RestaurantDemandInput {
  id: string;
  kind: "reservation" | "walk-in";
  guestName: string;
  guestEmail?: string | null;
  guestPhone?: string | null;
  covers: number;
  status: string;
  arrivedAt?: Date | null;
  scheduledAt?: Date | null;
  dietaryNotes?: string | null;
  vip?: boolean;
}

export interface RestaurantServerSectionInput {
  serverId: string;
  serverName: string;
  sectionLabel: string;
  tableIds: string[];
}

export interface RestaurantFloorInput {
  now: Date;
  tables: RestaurantFloorTableInput[];
  occupancies: RestaurantOccupancyInput[];
  holds: RestaurantHoldInput[];
  demands: RestaurantDemandInput[];
  serverSections: RestaurantServerSectionInput[];
  upcoming: RestaurantUpcomingAssignmentInput[];
}

export interface RestaurantForwardAvailability {
  kind: "now" | "at" | "unavailable";
  availableAt: string | null;
  minutes: number | null;
  reason: string;
}

export interface RestaurantFloorTable {
  id: string;
  label: string;
  capacity: number;
  serviceArea: string;
  shape: RestaurantTableShape;
  combinableWith: string[];
  combinationGroup: string | null;
  combinedWith: string[];
  state: RestaurantFloorState;
  statusLabel: string;
  blockedReason: string | null;
  timing: { kind: "on-time" | "turning" | "late"; minutes: number } | null;
  availability: RestaurantForwardAvailability;
  party: { id: string; name: string; covers: number } | null;
  turn: {
    id: string;
    turnId: string;
    stage: Exclude<RestaurantOccupancyStage, "reserved">;
    version: number;
  } | null;
  server: {
    id: string;
    name: string;
    sectionLabel: string;
    tableCount: number;
  } | null;
}

export interface RestaurantFloorDemand {
  id: string;
  kind: "reservation" | "walk-in";
  name: string;
  covers: number;
  waitedMinutes: number | null;
  scheduledAt: string | null;
  hasDietaryNote: boolean;
  vip: boolean;
  compatibleTableIds: string[];
  recommendation: {
    tableIds: string[];
    reason: string;
    warning: string | null;
  } | null;
}

export interface RestaurantFloorProjection {
  asOf: string;
  staffingAvailable: boolean;
  tables: RestaurantFloorTable[];
  demand: RestaurantFloorDemand[];
}

const STATE_LABEL: Record<RestaurantFloorState, string> = {
  available: "Available",
  held: "Held",
  reserved: "Reserved",
  seated: "Seated",
  ordered: "Ordered",
  paid: "Paid",
  dirty: "Dirty",
  blocked: "Blocked",
  "late-turn": "Late turn",
};

function minutesBetween(later: Date, earlier: Date): number {
  return Math.max(0, Math.round((later.getTime() - earlier.getTime()) / 60_000));
}

function activeAt(
  row: { startsAt: Date; endsAt: Date },
  now: Date,
): boolean {
  return row.startsAt.getTime() <= now.getTime() && now < row.endsAt;
}

function occupancyState(
  occupancy: RestaurantOccupancyInput,
  now: Date,
): Pick<RestaurantFloorTable, "state" | "timing"> {
  if (
    occupancy.stage !== "dirty" &&
    occupancy.expectedEndAt.getTime() < now.getTime()
  ) {
    return {
      state: "late-turn",
      timing: {
        kind: "late",
        minutes: minutesBetween(now, occupancy.expectedEndAt),
      },
    };
  }
  const remaining = minutesBetween(occupancy.expectedEndAt, now);
  return {
    state: occupancy.stage,
    timing:
      occupancy.stage === "dirty"
        ? null
        : {
            kind: remaining <= 15 ? "turning" : "on-time",
            minutes: remaining,
          },
  };
}

function availabilityFor(input: {
  now: Date;
  table: RestaurantFloorTableInput;
  state: RestaurantFloorState;
  occupancy?: RestaurantOccupancyInput;
  hold?: RestaurantHoldInput;
  upcoming?: RestaurantUpcomingAssignmentInput;
}): RestaurantForwardAvailability {
  const { now, state, occupancy, hold, upcoming } = input;
  if (state === "available") {
    return {
      kind: "now",
      availableAt: now.toISOString(),
      minutes: 0,
      reason: upcoming
        ? `Open now before the next reservation`
        : "Available for seating now",
    };
  }
  if (state === "blocked") {
    return {
      kind: "unavailable",
      availableAt: null,
      minutes: null,
      reason: "Not available for seating",
    };
  }
  if (state === "dirty") {
    return {
      kind: "unavailable",
      availableAt: null,
      minutes: null,
      reason: "Needs clearing before another party can be seated",
    };
  }
  if (state === "late-turn") {
    return {
      kind: "unavailable",
      availableAt: null,
      minutes: null,
      reason: "Current turn is running late",
    };
  }
  const availableAt =
    state === "held"
      ? hold?.endsAt
      : state === "reserved"
        ? upcoming?.endsAt
        : occupancy?.expectedEndAt;
  if (!availableAt) {
    return {
      kind: "unavailable",
      availableAt: null,
      minutes: null,
      reason: "Availability needs confirmation",
    };
  }
  const reason =
    state === "held"
      ? "Held for a booking in progress"
      : state === "reserved"
        ? "Reserved for an upcoming party"
        : state === "paid"
          ? "Current party is finishing"
          : "Current party is still dining";
  return {
    kind: "at",
    availableAt: availableAt.toISOString(),
    minutes: minutesBetween(availableAt, now),
    reason,
  };
}

function serverWarning(
  server: RestaurantFloorTable["server"],
  sections: RestaurantServerSectionInput[],
): string | null {
  if (!server || sections.length < 2) return null;
  const loads = sections
    .map((section) => ({
      name: section.serverName,
      count: new Set(section.tableIds).size,
    }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  const lightest = loads.at(-1)!;
  if (server.tableCount - lightest.count < 2) return null;
  return `${server.name} is carrying ${server.tableCount} tables while ${lightest.name} is carrying ${lightest.count}.`;
}

function projectedTablesCanCombine(
  left: RestaurantFloorTable,
  right: RestaurantFloorTable,
): boolean {
  const structurallyCompatible =
    (left.combinationGroup !== null &&
      left.combinationGroup === right.combinationGroup) ||
    (left.combinableWith.includes(right.id) &&
      right.combinableWith.includes(left.id));
  const staffingCompatible =
    left.server === null ||
    right.server === null ||
    left.server.id === right.server.id;
  return structurallyCompatible && staffingCompatible;
}

export function deriveRestaurantFloor(
  input: RestaurantFloorInput,
): RestaurantFloorProjection {
  const demandById = new Map(input.demands.map((row) => [row.id, row]));
  const activeHolds = new Map(
    input.holds
      .filter((row) => activeAt(row, input.now))
      .map((row) => [row.tableId, row]),
  );
  const occupancyByTable = new Map<string, RestaurantOccupancyInput>();
  for (const occupancy of input.occupancies) {
    for (const tableId of occupancy.tableIds) {
      occupancyByTable.set(tableId, occupancy);
    }
  }
  const upcomingByTable = new Map(
    input.upcoming
      .filter((row) => row.endsAt.getTime() > input.now.getTime())
      .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())
      .map((row) => [row.tableId, row]),
  );
  const serverByTable = new Map<
    string,
    RestaurantFloorTable["server"]
  >();
  for (const section of input.serverSections) {
    const tableCount = new Set(section.tableIds).size;
    for (const tableId of section.tableIds) {
      serverByTable.set(tableId, {
        id: section.serverId,
        name: section.serverName,
        sectionLabel: section.sectionLabel,
        tableCount,
      });
    }
  }

  const tables = input.tables.map((table): RestaurantFloorTable => {
    const attributes = parseRestaurantTableAttributes(table.attributes);
    const occupancy = occupancyByTable.get(table.id);
    const hold = activeHolds.get(table.id);
    const upcoming = upcomingByTable.get(table.id);
    let state: RestaurantFloorState;
    let timing: RestaurantFloorTable["timing"] = null;
    if (table.status !== "active") {
      state = "blocked";
    } else if (occupancy) {
      ({ state, timing } = occupancyState(occupancy, input.now));
    } else if (hold) {
      state = "held";
    } else if (
      upcoming &&
      upcoming.startsAt.getTime() - input.now.getTime() <= 30 * 60_000
    ) {
      state = "reserved";
    } else {
      state = "available";
    }
    const demand = occupancy ? demandById.get(occupancy.demandId) : undefined;
    return {
      id: table.id,
      label: table.label,
      capacity: table.capacity,
      serviceArea: table.serviceArea?.trim() || "Unassigned area",
      shape: attributes.shape,
      combinableWith: attributes.combinableWith,
      combinationGroup: attributes.combinationGroup,
      combinedWith: occupancy
        ? occupancy.tableIds.filter((tableId) => tableId !== table.id)
        : [],
      state,
      statusLabel: STATE_LABEL[state],
      blockedReason: table.blockedReason?.trim() || null,
      timing,
      availability: availabilityFor({
        now: input.now,
        table,
        state,
        occupancy,
        hold,
        upcoming,
      }),
      party:
        demand && occupancy
          ? { id: demand.id, name: demand.guestName, covers: demand.covers }
          : null,
      turn:
        occupancy?.turn && occupancy.stage !== "reserved"
          ? {
              ...occupancy.turn,
              stage: occupancy.stage,
            }
          : null,
      server: serverByTable.get(table.id) ?? null,
    };
  });

  const individuallyAvailable = tables.filter(
    (table) =>
      table.state === "available" ||
      (table.state === "held" &&
        (table.availability.minutes ?? Infinity) <= 15),
  );
  const openTables = individuallyAvailable.filter(
    (table) => table.state === "available",
  );
  type Candidate = {
    tables: RestaurantFloorTable[];
    capacity: number;
    readyInMinutes: number;
  };
  const candidateCache = new Map<number, Candidate[]>();
  const candidatesFor = (covers: number): Candidate[] => {
    const cached = candidateCache.get(covers);
    if (cached) return cached;
      const candidates: Array<{
        tables: RestaurantFloorTable[];
        capacity: number;
        readyInMinutes: number;
      }> = individuallyAvailable
        .filter((table) => table.capacity >= covers)
        .map((table) => ({
          tables: [table],
          capacity: table.capacity,
          readyInMinutes: table.availability.minutes ?? Infinity,
        }));
      for (let left = 0; left < openTables.length; left += 1) {
        for (let right = left + 1; right < openTables.length; right += 1) {
          const pair = [openTables[left], openTables[right]];
          const capacity = pair[0].capacity + pair[1].capacity;
          if (
            capacity >= covers &&
            projectedTablesCanCombine(pair[0], pair[1])
          ) {
            candidates.push({
              tables: pair,
              capacity,
              readyInMinutes: 0,
            });
          }
        }
      }
      candidates.sort(
        (left, right) =>
          left.capacity - right.capacity ||
          left.readyInMinutes - right.readyInMinutes ||
          left.tables
            .map((table) => table.label)
            .join("+")
            .localeCompare(
              right.tables.map((table) => table.label).join("+"),
            ),
      );
    candidateCache.set(covers, candidates);
    return candidates;
  };

  const demand = input.demands
    .filter((party) => party.status === "waiting")
    .map((party): RestaurantFloorDemand => {
      const candidates = candidatesFor(party.covers);
      const recommended = candidates[0] ?? null;
      const compatible = [
        ...new Set(
          candidates.flatMap((candidate) =>
            candidate.tables.map((table) => table.id)
          ),
        ),
      ];
      return {
        id: party.id,
        kind: party.kind,
        name: party.guestName,
        covers: party.covers,
        waitedMinutes: party.arrivedAt
          ? minutesBetween(input.now, party.arrivedAt)
          : null,
        scheduledAt: party.scheduledAt?.toISOString() ?? null,
        hasDietaryNote: Boolean(party.dietaryNotes?.trim()),
        vip: party.vip === true,
        compatibleTableIds: compatible,
        recommendation: recommended
          ? {
              tableIds: recommended.tables.map((table) => table.id),
              reason:
                recommended.readyInMinutes === 0
                  ? `${recommended.tables.map((table) => table.label).join(" + ")} ${recommended.tables.length === 1 ? "fits" : "fit"} ${party.covers} and ${recommended.tables.length === 1 ? "is" : "are"} open now.`
                  : `${recommended.tables.map((table) => table.label).join(" + ")} ${recommended.tables.length === 1 ? "fits" : "fit"} ${party.covers} and ${recommended.tables.length === 1 ? "is" : "are"} expected in ${recommended.readyInMinutes} minutes.`,
              warning: serverWarning(
                recommended.tables[0].server,
                input.serverSections,
              ),
            }
          : null,
      };
    });

  return {
    asOf: input.now.toISOString(),
    staffingAvailable: input.serverSections.length > 0,
    tables,
    demand,
  };
}

export interface CustomerRestaurantAvailability {
  asOf: string;
  summary: {
    totalTables: number;
    availableNow: number;
    availableSoon: number;
  };
  tables: Array<{
    key: string;
    capacity: number;
    shape: RestaurantTableShape;
    serviceArea: string;
    availability: {
      kind: RestaurantForwardAvailability["kind"];
      availableAt: string | null;
      minutes: number | null;
      explanation: string;
    };
  }>;
}

function customerExplanation(
  availability: RestaurantForwardAvailability,
): string {
  if (availability.kind === "now") return "Available now";
  if (availability.kind === "at" && availability.minutes != null) {
    return `Available in about ${availability.minutes} minutes`;
  }
  return "Availability will be confirmed when you book";
}

/**
 * Explicit allow-list boundary for public/customer surfaces. Do not spread the
 * operator projection here: adding a field must be a deliberate privacy change.
 */
export function projectCustomerRestaurantAvailability(
  floor: RestaurantFloorProjection,
): CustomerRestaurantAvailability {
  return {
    asOf: floor.asOf,
    summary: {
      totalTables: floor.tables.length,
      availableNow: floor.tables.filter(
        (table) => table.availability.kind === "now",
      ).length,
      availableSoon: floor.tables.filter(
        (table) => table.availability.kind === "at",
      ).length,
    },
    tables: floor.tables.map((table, index) => ({
      // Presentation identity only. Never reuse the persisted table id or label
      // at the public boundary, even when an internal id happens to look human.
      key: `availability-${index + 1}`,
      capacity: table.capacity,
      shape: table.shape,
      serviceArea: table.serviceArea,
      availability: {
        kind: table.availability.kind,
        availableAt: table.availability.availableAt,
        minutes: table.availability.minutes,
        explanation: customerExplanation(table.availability),
      },
    })),
  };
}
