// Coworker Simulation & Eval Harness — dispatch scenario library (H1).
//
// Named, reproducible scenarios encoding real-world variants (§7.1). Each is a
// pure factory returning a ScenarioSpec; `runScenario` plays it on the virtual
// clock. Geo coordinates are Austin-area; distances drive realistic travel time.

import type { GeoPoint } from "./geo-temporal";
import type { ScenarioSpec } from "./dispatch-sim";

const DEPOT: GeoPoint = { lat: 30.27, lng: -97.74 };
const near = (dLat: number, dLng: number): GeoPoint => ({ lat: DEPOT.lat + dLat, lng: DEPOT.lng + dLng });

/** Baseline: reachable customers, generous windows — everything goes right. */
export function normalDay(): ScenarioSpec {
  return {
    id: "normal-day",
    startIso: "2026-06-15T08:00:00.000Z",
    technicians: [
      { id: "T1", home: DEPOT },
      { id: "T2", home: DEPOT },
    ],
    customers: [
      { id: "C1", site: near(0.05, 0.0), reachable: true },
      { id: "C2", site: near(0.0, 0.06), reachable: true },
      { id: "C3", site: near(-0.04, 0.03), reachable: true },
    ],
    jobs: [
      { id: "J1", customerId: "C1", departOffsetMin: 60, windowMin: 120, serviceMin: 45 },
      { id: "J2", customerId: "C2", departOffsetMin: 180, windowMin: 240, serviceMin: 60 },
      { id: "J3", customerId: "C3", departOffsetMin: 300, windowMin: 360, serviceMin: 30 },
    ],
    traffic: 1,
  };
}

/** Geo-temporal variant: rush-hour traffic pushes the ETA past a tight window. */
export function rushHourDelay(): ScenarioSpec {
  return {
    id: "rush-hour-delay",
    startIso: "2026-06-15T07:00:00.000Z",
    technicians: [{ id: "T1", home: DEPOT }],
    customers: [{ id: "C1", site: near(0.12, 0.0), reachable: true }], // ~13 km
    jobs: [{ id: "J1", customerId: "C1", departOffsetMin: 30, windowMin: 45, serviceMin: 30 }],
    traffic: 1.6,
  };
}

/** A customer with no reachable channel — notifications must surface as exceptions. */
export function unreachableCustomer(): ScenarioSpec {
  return {
    id: "unreachable-customer",
    startIso: "2026-06-15T08:00:00.000Z",
    technicians: [{ id: "T1", home: DEPOT }],
    customers: [{ id: "C1", site: near(0.05, 0.0), reachable: false }],
    jobs: [{ id: "J1", customerId: "C1", departOffsetMin: 60, windowMin: 120, serviceMin: 30 }],
    traffic: 1,
  };
}
