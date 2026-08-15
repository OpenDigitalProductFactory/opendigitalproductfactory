import type { RestaurantTableAttributes } from "@/lib/storefront/restaurant-table-attributes";

const MINUTE = 60_000;
// Demo sections represent an always-ready sample roster, not a scheduled shift
// owned by a real employee. Keep that synthetic coverage stable across long-lived
// demo installs; real restaurant shifts continue to use bounded intervals.
const DEMO_SECTION_START = new Date("2020-01-01T00:00:00.000Z");
const DEMO_SECTION_END = new Date("2100-01-01T00:00:00.000Z");

export interface RestaurantDemoBookingInput {
  id: string;
  bookingRef: string;
}

export interface RestaurantDemoEmployeeInput {
  id: string;
  displayName: string;
  role: string;
}

export interface RestaurantDemoTablePlan {
  key: string;
  resourceId: string;
  label: string;
  capacity: number;
  serviceArea: string;
  status: "active" | "blocked";
  blockedReason: string | null;
  attributes: RestaurantTableAttributes;
}

export interface RestaurantDemoBookingPlan {
  id: string;
  bookingRef: string;
  demandKind: "walk-in" | "reservation";
  covers: number;
  status: string;
  scheduledAt: Date;
  createdAt: Date;
  durationMinutes: number;
  dietaryNotes: string | null;
}

export interface RestaurantDemoTurnPlan {
  turnId: string;
  bookingId: string;
  bookingRef: string;
  stage: "seated" | "ordered" | "paid" | "dirty";
  startedAt: Date;
  expectedEndAt: Date;
  tableKeys: string[];
  serverIndex: number;
}

export interface RestaurantDemoServerSectionPlan {
  shiftId: string;
  assignmentId: string;
  employeeId: string;
  employeeName: string;
  startAt: Date;
  endAt: Date;
  timezone: string;
  tableKeys: string[];
}

const TABLES: ReadonlyArray<Omit<RestaurantDemoTablePlan, "resourceId">> = [
  { key: "table-1", label: "Aster 1", capacity: 4, serviceArea: "Main dining", status: "active", blockedReason: null, attributes: { shape: "round", combinationGroup: null, combinableWith: [], bookingAccess: "online" } },
  { key: "table-2", label: "Aster 2", capacity: 4, serviceArea: "Main dining", status: "active", blockedReason: null, attributes: { shape: "round", combinationGroup: null, combinableWith: [], bookingAccess: "online" } },
  { key: "table-3", label: "Aster 3", capacity: 2, serviceArea: "Main dining", status: "active", blockedReason: null, attributes: { shape: "square", combinationGroup: null, combinableWith: [], bookingAccess: "in-house" } },
  { key: "table-4", label: "Aster 4", capacity: 4, serviceArea: "Main dining", status: "blocked", blockedReason: "Chair repair", attributes: { shape: "round", combinationGroup: null, combinableWith: [], bookingAccess: "in-house" } },
  { key: "table-5", label: "Harvest 1", capacity: 4, serviceArea: "Main dining", status: "active", blockedReason: null, attributes: { shape: "rectangle", combinationGroup: "banquet-a", combinableWith: ["table-6"], bookingAccess: "online" } },
  { key: "table-6", label: "Harvest 2", capacity: 4, serviceArea: "Main dining", status: "active", blockedReason: null, attributes: { shape: "rectangle", combinationGroup: "banquet-a", combinableWith: ["table-5"], bookingAccess: "online" } },
  { key: "table-7", label: "Window 1", capacity: 2, serviceArea: "Window room", status: "active", blockedReason: null, attributes: { shape: "booth", combinationGroup: null, combinableWith: [], bookingAccess: "online" } },
  { key: "table-8", label: "Window 2", capacity: 4, serviceArea: "Window room", status: "active", blockedReason: null, attributes: { shape: "booth", combinationGroup: null, combinableWith: [], bookingAccess: "in-house" } },
  { key: "table-9", label: "Patio 1", capacity: 6, serviceArea: "Patio", status: "active", blockedReason: null, attributes: { shape: "rectangle", combinationGroup: null, combinableWith: [], bookingAccess: "online" } },
];

function at(now: Date, minutes: number): Date {
  return new Date(now.getTime() + minutes * MINUTE);
}

export function buildRestaurantDemoFloorPlan(input: {
  bookings: readonly RestaurantDemoBookingInput[];
  employees: readonly RestaurantDemoEmployeeInput[];
  now: Date;
  timezone: string;
}) {
  if (input.bookings.length < 7) {
    throw new Error("restaurant demo floor requires at least seven demand rows");
  }
  const servers = input.employees.filter((employee) =>
    /\bserver\b/i.test(employee.role),
  );
  if (servers.length < 2) {
    throw new Error("restaurant demo floor requires two server employees");
  }

  const tables: RestaurantDemoTablePlan[] = TABLES.map((table) => ({
    ...table,
    attributes: { ...table.attributes, combinableWith: [...table.attributes.combinableWith] },
    resourceId: `demo-restaurant-${table.key}`,
  }));
  const demand = [
    { index: 0, demandKind: "walk-in" as const, covers: 3, status: "waiting", scheduled: 0, created: -14, duration: 90, dietaryNotes: null },
    { index: 1, demandKind: "reservation" as const, covers: 4, status: "confirmed", scheduled: 9, created: -120, duration: 90, dietaryNotes: null },
    { index: 2, demandKind: "reservation" as const, covers: 4, status: "seated", scheduled: -55, created: -180, duration: 90, dietaryNotes: null },
    { index: 3, demandKind: "walk-in" as const, covers: 2, status: "seated", scheduled: -100, created: -108, duration: 90, dietaryNotes: null },
    { index: 4, demandKind: "reservation" as const, covers: 8, status: "seated", scheduled: -50, created: -240, duration: 90, dietaryNotes: null },
    { index: 5, demandKind: "walk-in" as const, covers: 2, status: "seated", scheduled: -84, created: -91, duration: 90, dietaryNotes: null },
    { index: 6, demandKind: "reservation" as const, covers: 4, status: "seated", scheduled: -102, created: -210, duration: 90, dietaryNotes: null },
  ];
  const bookings: RestaurantDemoBookingPlan[] = demand.map((entry) => {
    const booking = input.bookings[entry.index]!;
    return {
      id: booking.id,
      bookingRef: booking.bookingRef,
      demandKind: entry.demandKind,
      covers: entry.covers,
      status: entry.status,
      scheduledAt: at(input.now, entry.scheduled),
      createdAt: at(input.now, entry.created),
      durationMinutes: entry.duration,
      dietaryNotes: entry.dietaryNotes,
    };
  });
  const turns: RestaurantDemoTurnPlan[] = [
    { bookingIndex: 2, stage: "ordered" as const, started: -55, ends: 35, tableKeys: ["table-2"], serverIndex: 0 },
    { bookingIndex: 3, stage: "dirty" as const, started: -100, ends: -10, tableKeys: ["table-3"], serverIndex: 0 },
    { bookingIndex: 4, stage: "ordered" as const, started: -50, ends: 40, tableKeys: ["table-5", "table-6"], serverIndex: 0 },
    { bookingIndex: 5, stage: "paid" as const, started: -84, ends: 6, tableKeys: ["table-7"], serverIndex: 1 },
    { bookingIndex: 6, stage: "seated" as const, started: -102, ends: -12, tableKeys: ["table-8"], serverIndex: 0 },
  ].map((turn) => {
    const booking = input.bookings[turn.bookingIndex]!;
    return {
      turnId: `demo-restaurant-turn-${turn.bookingIndex}`,
      bookingId: booking.id,
      bookingRef: booking.bookingRef,
      stage: turn.stage,
      startedAt: at(input.now, turn.started),
      expectedEndAt: at(input.now, turn.ends),
      tableKeys: turn.tableKeys,
      serverIndex: turn.serverIndex,
    };
  });
  const serverSections: RestaurantDemoServerSectionPlan[] = [
    { server: servers[0]!, index: 0, tableKeys: ["table-1", "table-2", "table-3", "table-4", "table-5", "table-8"] },
    { server: servers[1]!, index: 1, tableKeys: ["table-6", "table-7", "table-9"] },
  ].map(({ server, index, tableKeys }) => ({
    shiftId: `demo-restaurant-shift-${index + 1}`,
    assignmentId: `demo-restaurant-assignment-${index + 1}`,
    employeeId: server.id,
    employeeName: server.displayName,
    startAt: DEMO_SECTION_START,
    endAt: DEMO_SECTION_END,
    timezone: input.timezone,
    tableKeys,
  }));

  return { tables, bookings, turns, serverSections };
}
