import type { ArchetypeDefinition } from "./types";
import {
  deriveTwinProfile,
  type TwinProfile,
  type TwinTemplate,
} from "./twin-profile";
import { resolvePerformanceMetricPack } from "./performance-metric-catalog";

export type OperationsTextAlternative = "list" | "table";

export interface PerformanceMetricDefinition {
  key: string;
  label: string;
  unit: "count" | "currency" | "percent" | "duration" | "rate";
  sourceOwner: string;
  grain: "day" | "week" | "month";
  aggregation: string;
  comparison: "prior-period" | "prior-year" | "target" | "none";
  drilldownRoute?: string;
  sensitivity: "business" | "financial" | "workforce" | "customer";
}

export interface PerformanceMetricPack {
  headline: readonly string[];
  operating: readonly string[];
  financial: readonly string[];
  customer: readonly string[];
  workforce: readonly string[];
}

export interface OperationsViewProfile {
  twinProfile: TwinProfile;
  sceneAdapter: string;
  currentStateSelector: string;
  commandKinds: readonly string[];
  conflictKinds: readonly string[];
  textAlternative: OperationsTextAlternative;
}

export interface ArchetypeBusinessViews {
  archetypeId: string;
  operations: OperationsViewProfile;
  performance: PerformanceMetricPack;
}

type OperationsGrammar = Omit<OperationsViewProfile, "twinProfile">;

const OPERATIONS_BY_TEMPLATE: Record<TwinTemplate, OperationsGrammar> = {
  FLOOR: {
    sceneAdapter: "floor-plan",
    currentStateSelector: "live-service",
    commandKinds: ["seat-party", "move-party", "change-table-state", "swap-server"],
    conflictKinds: ["capacity", "overlap", "server-load", "turn-time"],
    textAlternative: "table",
  },
  BOOK: {
    sceneAdapter: "provider-resource-book",
    currentStateSelector: "selected-day",
    commandKinds: ["book-appointment", "assign-provider", "assign-resource", "fill-gap"],
    conflictKinds: ["skill", "provider-overlap", "resource-overlap", "buffer"],
    textAlternative: "table",
  },
  ROOMS: {
    sceneAdapter: "occupancy-grid",
    currentStateSelector: "stay-horizon",
    commandKinds: ["assign-room", "move-stay", "block-room", "mark-inspection"],
    conflictKinds: ["room-type", "stay-overlap", "blocked-room", "inspection"],
    textAlternative: "table",
  },
  YARD: {
    sceneAdapter: "inventory-location-horizon",
    currentStateSelector: "rental-horizon",
    commandKinds: ["reserve-asset", "check-out", "check-in", "schedule-downtime"],
    conflictKinds: ["availability", "location", "buffer", "maintenance"],
    textAlternative: "table",
  },
  TERRITORY: {
    sceneAdapter: "dispatch-map-schedule",
    currentStateSelector: "live-dispatch",
    commandKinds: ["assign-job", "reorder-route", "reschedule-job", "prioritize-work"],
    conflictKinds: ["skill", "arrival-window", "travel-time", "overlap"],
    textAlternative: "table",
  },
  BAYS: {
    sceneAdapter: "bay-schedule",
    currentStateSelector: "live-shop",
    commandKinds: ["assign-bay", "assign-technician", "change-work-state", "hold-for-parts"],
    conflictKinds: ["bay-fit", "skill", "parts", "overlap"],
    textAlternative: "table",
  },
  STORE: {
    sceneAdapter: "store-inventory",
    currentStateSelector: "live-trade",
    commandKinds: ["restock", "pick-order", "open-lane", "resolve-shortage"],
    conflictKinds: ["stock", "fulfillment-capacity", "lane-capacity", "deadline"],
    textAlternative: "table",
  },
  VENUE: {
    sceneAdapter: "venue-capacity-run",
    currentStateSelector: "event-horizon",
    commandKinds: ["allocate-space", "hold-capacity", "release-capacity", "change-run-state"],
    conflictKinds: ["capacity", "date-overlap", "access", "turnaround"],
    textAlternative: "table",
  },
  COUNTER: {
    sceneAdapter: "service-counter",
    currentStateSelector: "live-queue",
    commandKinds: ["call-next", "assign-counter", "change-case-state", "escalate"],
    conflictKinds: ["eligibility", "priority", "counter-skill", "sla"],
    textAlternative: "list",
  },
  DOCK: {
    sceneAdapter: "dock-rack-flow",
    currentStateSelector: "live-warehouse",
    commandKinds: ["assign-dock", "release-wave", "assign-picker", "hold-load"],
    conflictKinds: ["dock-capacity", "inventory", "labor", "cutoff"],
    textAlternative: "table",
  },
  TENANTS: {
    sceneAdapter: "account-health-board",
    currentStateSelector: "current-portfolio",
    commandKinds: ["assign-owner", "prioritize-account", "open-intervention"],
    conflictKinds: ["ownership", "capacity", "sla"],
    textAlternative: "table",
  },
  PIPELINE: {
    sceneAdapter: "work-pipeline",
    currentStateSelector: "active-work",
    commandKinds: ["assign-work", "change-stage", "set-priority", "resolve-blocker"],
    conflictKinds: ["workload", "deadline", "dependency", "skill"],
    textAlternative: "table",
  },
  PROGRAMS: {
    sceneAdapter: "program-portfolio",
    currentStateSelector: "active-programs",
    commandKinds: ["allocate-capacity", "change-program-state", "set-priority"],
    conflictKinds: ["funding", "capacity", "deadline"],
    textAlternative: "table",
  },
};

/** Pure, deterministic bridge from one archetype definition to both main-rail views. */
export function deriveArchetypeBusinessViews(
  archetype: ArchetypeDefinition,
): ArchetypeBusinessViews {
  const twinProfile = deriveTwinProfile(archetype);
  return {
    archetypeId: archetype.archetypeId,
    operations: {
      twinProfile,
      ...OPERATIONS_BY_TEMPLATE[twinProfile.template],
    },
    performance: resolvePerformanceMetricPack(archetype.archetypeId),
  };
}
