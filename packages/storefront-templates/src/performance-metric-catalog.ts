import type {
  BusinessAnalysisDimensionKey,
  PerformanceMetricCalculation,
  PerformanceMetricDefinition,
  PerformanceMetricPack,
} from "./business-view-profile";
import type { TwinTemplate } from "./twin-profile";

export const PERFORMANCE_METRIC_DEFINITION_VERSION = "2026-08-01.2";

const calculation = (
  kind: PerformanceMetricCalculation["kind"],
  ...inputs: string[]
): PerformanceMetricCalculation => ({ kind, inputs });

const CALCULATIONS: Readonly<Record<string, PerformanceMetricCalculation>> = {
  sales: calculation("sum", "recognized-sales"),
  revenue: calculation("sum", "recognized-revenue"),
  "gross-margin": calculation("ratio", "gross-profit", "revenue"),
  "cash-position": calculation("closing-balance", "available-cash"),
  demand: calculation("count", "accepted-demand"),
  throughput: calculation("count", "completed-work"),
  "cycle-time": calculation("median", "accepted-at", "completed-at"),
  covers: calculation("count", "seated-guests"),
  "average-check": calculation("ratio", "net-sales", "closed-checks"),
  "table-utilization": calculation("ratio", "occupied-table-minutes", "available-table-minutes"),
  "turn-time": calculation("median", "seated-at", "available-at"),
  "wait-no-show-rate": calculation("ratio", "unseated-or-no-show-parties", "expected-parties"),
  "labor-percentage": calculation("ratio", "labor-cost", "sales"),
  appointments: calculation("count", "completed-appointments"),
  occupancy: calculation("ratio", "booked-resource-minutes", "available-resource-minutes"),
  "rebooking-retention": calculation("ratio", "returning-clients", "eligible-clients"),
  "no-show-rate": calculation("ratio", "no-shows", "scheduled-appointments"),
  "staff-utilization": calculation("ratio", "productive-minutes", "available-minutes"),
  "retail-mix": calculation("ratio", "retail-sales", "total-sales"),
  adr: calculation("ratio", "room-revenue", "occupied-rooms"),
  revpar: calculation("ratio", "room-revenue", "available-rooms"),
  "booking-pace": calculation("grouped-sum", "net-rooms-booked", "stay-date", "lead-time"),
  "channel-mix": calculation("grouped-sum", "booked-rooms", "acquisition-channel"),
  "room-turnaround": calculation("median", "checkout-at", "ready-at"),
  "out-of-service-nights": calculation("sum", "unavailable-room-nights"),
  "fleet-utilization": calculation("ratio", "committed-rentable-time", "available-rentable-time"),
  "rental-revenue": calculation("sum", "recognized-rental-revenue"),
  "asset-roi": calculation("ratio", "asset-operating-return", "invested-cost"),
  "asset-downtime": calculation("sum", "unavailable-asset-time"),
  "late-return-rate": calculation("ratio", "late-returns", "due-returns"),
  "lost-demand-substitution": calculation("ratio", "unfilled-or-substituted-requests", "accepted-requests"),
  "open-aging-actions": calculation("count", "open-actions", "aging-band"),
  "sla-attainment": calculation("ratio", "within-commitment-work", "completed-work"),
  "work-order-cost": calculation("sum", "approved-work-order-cost"),
  "vendor-cycle-time": calculation("median", "assigned-at", "completed-at"),
  collections: calculation("sum", "applied-payments"),
  "authorized-violations": calculation("count", "role-visible-open-cases"),
  jobs: calculation("count", "completed-jobs"),
  conversion: calculation("ratio", "sold-opportunities", "presented-opportunities"),
  "technician-utilization": calculation("ratio", "productive-technician-time", "available-technician-time"),
  "drive-time": calculation("sum", "technician-travel-duration"),
  "first-time-fix-rate": calculation("ratio", "first-visit-completions", "completed-jobs"),
  "capacity-leakage": calculation("sum", "avoidable-lost-capacity-time"),
};

const calculationFor = (key: string): PerformanceMetricCalculation => {
  const configured = CALCULATIONS[key];
  if (!configured) throw new Error(`Missing typed calculation for metric ${key}`);
  return configured;
};

const DEFAULT_DIMENSIONS = ["organization"] as const;
const LOCATION_DIMENSIONS = ["organization", "location"] as const;
const CUSTOMER_DIMENSIONS = ["organization", "location", "customer"] as const;
const PRODUCT_DIMENSIONS = ["organization", "location", "product"] as const;
const WORKFORCE_DIMENSIONS = ["organization", "location", "worker"] as const;
const CHANNEL_DIMENSIONS = ["organization", "location", "channel"] as const;

const dimensionsFor = (key: string): readonly BusinessAnalysisDimensionKey[] => {
  if (["channel-mix", "booking-pace"].includes(key)) return CHANNEL_DIMENSIONS;
  if (["sales", "revenue", "gross-margin", "average-check", "retail-mix", "rental-revenue", "asset-roi"].includes(key)) return PRODUCT_DIMENSIONS;
  if (["covers", "wait-no-show-rate", "appointments", "rebooking-retention", "no-show-rate", "late-return-rate", "lost-demand-substitution", "first-time-fix-rate"].includes(key)) return CUSTOMER_DIMENSIONS;
  if (["labor-percentage", "staff-utilization", "technician-utilization", "drive-time", "capacity-leakage"].includes(key)) return WORKFORCE_DIMENSIONS;
  if (["table-utilization", "turn-time", "occupancy", "adr", "revpar", "room-turnaround", "out-of-service-nights", "fleet-utilization", "asset-downtime", "open-aging-actions", "sla-attainment", "work-order-cost", "vendor-cycle-time", "collections", "authorized-violations", "jobs", "conversion"].includes(key)) return LOCATION_DIMENSIONS;
  return DEFAULT_DIMENSIONS;
};

export interface PriorityPhysicalViewPack {
  archetypeId: string;
  template: TwinTemplate;
  spaceKind: string;
  operatorJob: string;
  performance: PerformanceMetricPack;
}

const metric = (
  key: string,
  label: string,
  unit: PerformanceMetricDefinition["unit"],
  sourceOwner: string,
  grain: PerformanceMetricDefinition["grain"],
  aggregation: string,
  comparison: PerformanceMetricDefinition["comparison"],
  sensitivity: PerformanceMetricDefinition["sensitivity"],
  drilldownRoute?: string,
): PerformanceMetricDefinition => ({
  key,
  label,
  unit,
  sourceOwner,
  grain,
  definition: aggregation,
  calculation: calculationFor(key),
  allowedDimensions: dimensionsFor(key),
  supportedComparisons: comparison === "none" ? ["none"] : [comparison, "none"],
  aggregation,
  comparison,
  sensitivity,
  materiality: {
    modes: ["absolute", "relative"],
    directions: ["increase", "decrease", "either"],
  },
  ...(drilldownRoute ? { drilldownRoute } : {}),
});

const definitions = [
  metric("sales", "Sales", "currency", "orders", "day", "sum recognized sales", "prior-period", "financial", "/storefront/orders"),
  metric("revenue", "Revenue", "currency", "finance", "month", "sum recognized revenue", "prior-period", "financial"),
  metric("gross-margin", "Gross margin", "percent", "finance", "month", "(revenue - direct cost) / revenue", "target", "financial"),
  metric("cash-position", "Cash position", "currency", "finance", "day", "closing available cash", "prior-period", "financial"),
  metric("demand", "Demand", "count", "work-intake", "day", "count accepted demand", "prior-period", "business"),
  metric("throughput", "Throughput", "count", "work-execution", "day", "count completed work", "prior-period", "business"),
  metric("cycle-time", "Cycle time", "duration", "work-execution", "day", "median accepted-to-complete duration", "target", "business"),
  metric("covers", "Covers", "count", "restaurant-service", "day", "count seated guests", "prior-period", "customer"),
  metric("average-check", "Average check", "currency", "orders", "day", "net sales / closed checks", "prior-period", "financial"),
  metric("table-utilization", "Table utilization", "percent", "restaurant-floor", "day", "occupied table-minutes / available table-minutes", "target", "business", "/workspace"),
  metric("turn-time", "Turn time", "duration", "restaurant-floor", "day", "median seated-to-available duration", "target", "business", "/workspace"),
  metric("wait-no-show-rate", "Wait / no-show rate", "rate", "guest-arrivals", "day", "unseated or no-show parties / expected parties", "target", "customer"),
  metric("labor-percentage", "Labor percentage", "percent", "workforce-scheduling", "week", "labor cost / sales", "target", "workforce"),
  metric("appointments", "Appointments", "count", "appointment-book", "day", "count completed appointments", "prior-period", "customer"),
  metric("occupancy", "Occupancy", "percent", "resource-calendar", "day", "booked resource-minutes / available resource-minutes", "target", "business", "/workspace"),
  metric("rebooking-retention", "Rebooking / retention", "rate", "customer-relationships", "month", "returning clients / eligible clients", "prior-year", "customer"),
  metric("no-show-rate", "No-show rate", "rate", "appointment-book", "day", "no-shows / scheduled appointments", "target", "customer"),
  metric("staff-utilization", "Staff utilization", "percent", "workforce-scheduling", "day", "productive minutes / available minutes", "target", "workforce"),
  metric("retail-mix", "Retail mix", "percent", "orders", "month", "retail sales / total sales", "target", "financial"),
  metric("adr", "Average daily rate", "currency", "hotel-folio", "day", "room revenue / occupied rooms", "prior-year", "financial"),
  metric("revpar", "Revenue per available room", "currency", "hotel-folio", "day", "room revenue / available rooms", "prior-year", "financial"),
  metric("booking-pace", "Booking pace", "rate", "reservations", "day", "net rooms booked by stay date and lead time", "prior-year", "business"),
  metric("channel-mix", "Channel mix", "percent", "reservations", "month", "booked rooms grouped by acquisition channel", "target", "customer"),
  metric("room-turnaround", "Room turnaround", "duration", "housekeeping", "day", "median checkout-to-ready duration", "target", "business", "/workspace"),
  metric("out-of-service-nights", "Out-of-service nights", "count", "room-inventory", "week", "sum unavailable sellable room-nights", "target", "business"),
  metric("fleet-utilization", "Fleet utilization", "percent", "rental-inventory", "day", "committed rentable time / available rentable time", "target", "business", "/workspace"),
  metric("rental-revenue", "Rental revenue", "currency", "rental-agreements", "month", "sum recognized rental revenue", "prior-period", "financial"),
  metric("asset-roi", "Asset ROI", "percent", "asset-ledger", "month", "(asset revenue - direct cost) / invested cost", "target", "financial"),
  metric("asset-downtime", "Asset downtime", "duration", "rental-inventory", "day", "sum unavailable asset time", "target", "business"),
  metric("late-return-rate", "Late-return rate", "rate", "rental-agreements", "week", "late returns / due returns", "target", "customer"),
  metric("lost-demand-substitution", "Lost demand / substitution", "rate", "rental-demand", "week", "unfilled or substituted requests / accepted requests", "target", "customer"),
  metric("open-aging-actions", "Open and aging actions", "count", "association-actions", "week", "count open actions grouped by aging band", "target", "business", "/workspace"),
  metric("sla-attainment", "SLA attainment", "percent", "work-orders", "week", "work completed within commitment / completed work", "target", "business"),
  metric("work-order-cost", "Work-order cost", "currency", "work-orders", "month", "sum approved work-order cost", "prior-period", "financial"),
  metric("vendor-cycle-time", "Vendor cycle time", "duration", "vendor-work", "week", "median assignment-to-complete duration", "target", "business"),
  metric("collections", "Collections", "currency", "association-ledger", "month", "sum payments applied", "target", "financial"),
  metric("authorized-violations", "Authorized violation backlog", "count", "compliance-cases", "week", "count open cases visible to the current role", "target", "customer"),
  metric("jobs", "Jobs completed", "count", "field-service-jobs", "day", "count completed jobs", "prior-period", "business"),
  metric("conversion", "Conversion", "rate", "field-service-sales", "week", "sold opportunities / presented opportunities", "target", "customer"),
  metric("technician-utilization", "Technician utilization", "percent", "field-workforce", "day", "productive technician time / available time", "target", "workforce"),
  metric("drive-time", "Drive time", "duration", "field-dispatch", "day", "sum technician travel duration", "target", "workforce", "/workspace"),
  metric("first-time-fix-rate", "First-time-fix rate", "rate", "field-service-jobs", "week", "jobs completed without return visit / completed jobs", "target", "customer"),
  metric("capacity-leakage", "Capacity leakage", "duration", "field-dispatch", "day", "available time lost to gaps, conflicts, and avoidable travel", "target", "business"),
] as const;

export const PERFORMANCE_METRIC_DEFINITIONS: ReadonlyMap<string, PerformanceMetricDefinition> =
  new Map(definitions.map((definition) => [definition.key, definition]));

const pack = (
  headline: readonly string[],
  operating: readonly string[],
  financial: readonly string[],
  customer: readonly string[],
  workforce: readonly string[],
): PerformanceMetricPack => ({ headline, operating, financial, customer, workforce });

export const GENERIC_PERFORMANCE_PACK = pack(
  ["revenue", "gross-margin", "demand", "throughput"],
  ["cycle-time"],
  ["cash-position"],
  [],
  [],
);

export const PRIORITY_PHYSICAL_VIEW_PACKS: Readonly<Record<string, PriorityPhysicalViewPack>> = {
  restaurant: {
    archetypeId: "restaurant",
    template: "FLOOR",
    spaceKind: "table floor plan",
    operatorJob: "seat arriving parties quickly without creating capacity or server-load conflicts",
    performance: pack(
      ["sales", "covers", "average-check", "table-utilization"],
      ["turn-time"],
      ["labor-percentage"],
      ["wait-no-show-rate"],
      [],
    ),
  },
  "hair-salon": {
    archetypeId: "hair-salon",
    template: "BOOK",
    spaceKind: "provider-by-chair appointment book",
    operatorJob: "assign each service to an available qualified beautician and physical chair",
    performance: pack(
      ["sales", "appointments", "occupancy"],
      [],
      ["retail-mix"],
      ["rebooking-retention", "no-show-rate"],
      ["staff-utilization"],
    ),
  },
  "independent-hotel": {
    archetypeId: "independent-hotel",
    template: "ROOMS",
    spaceKind: "room occupancy calendar",
    operatorJob: "place each stay into a ready compatible room across its full date interval",
    performance: pack(
      ["occupancy", "adr", "revpar", "booking-pace"],
      ["room-turnaround", "out-of-service-nights"],
      [],
      ["channel-mix"],
      [],
    ),
  },
  "equipment-rental": {
    archetypeId: "equipment-rental",
    template: "YARD",
    spaceKind: "dated inventory and location yard",
    operatorJob: "promise the right asset for the requested interval while preserving location and maintenance truth",
    performance: pack(
      ["fleet-utilization", "rental-revenue", "asset-roi"],
      ["asset-downtime"],
      [],
      ["late-return-rate", "lost-demand-substitution"],
      [],
    ),
  },
  "homeowners-association": {
    archetypeId: "homeowners-association",
    template: "TERRITORY",
    spaceKind: "property portfolio and priority map",
    operatorJob: "prioritize current property actions by urgency, responsibility, commitment, and resident impact",
    performance: pack(
      ["open-aging-actions", "sla-attainment", "work-order-cost"],
      ["vendor-cycle-time"],
      ["collections"],
      ["authorized-violations"],
      [],
    ),
  },
  "hvac-contractor": {
    archetypeId: "hvac-contractor",
    template: "TERRITORY",
    spaceKind: "technician dispatch map and route schedule",
    operatorJob: "assign queued demand to qualified technicians while minimizing conflicts, delay, and avoidable travel",
    performance: pack(
      ["revenue", "jobs", "conversion", "technician-utilization"],
      ["drive-time", "capacity-leakage"],
      [],
      ["first-time-fix-rate"],
      [],
    ),
  },
};

export function getPerformanceMetricDefinition(
  key: string,
): PerformanceMetricDefinition | undefined {
  return PERFORMANCE_METRIC_DEFINITIONS.get(key);
}

export function resolvePerformanceMetricPack(
  archetypeId: string,
): PerformanceMetricPack {
  return PRIORITY_PHYSICAL_VIEW_PACKS[archetypeId]?.performance ?? GENERIC_PERFORMANCE_PACK;
}
