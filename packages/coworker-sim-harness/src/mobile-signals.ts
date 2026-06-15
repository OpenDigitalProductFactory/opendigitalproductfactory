// Coworker Simulation & Eval Harness — mobile field-device signal contract (H1).
//
// In production the routing sensors and status updates a dispatcher relies on
// come from the technician's MOBILE device: GPS location, departure/arrival
// (geofence), ETA, and status taps. This module defines that signal contract as
// a typed schema and provides a deterministic stub that produces the same stream
// from the geo-temporal model + virtual clock.
//
// CONVERGENCE: `MobileFieldSignal` is the single shared contract. The separate
// mobile-app design thread emits this stream from real GPS/taps; this harness
// emits it from `planDrive`. Functional parity between the app and the harness
// stub means both honour this schema — the stub is the contract, not a throwaway.
// See 2026-06-14-coworker-simulation-eval-harness-design.html (R11 MobileFieldSignalContract).

import type { Instant } from "./virtual-clock";
import { type GeoPoint, type TravelOptions, etaAt, geoDistanceKm, travelTimeMinutes } from "./geo-temporal";

/**
 * The signals a field device emits to the dispatcher. Same schema for the real
 * mobile app and the harness stub.
 */
export type MobileFieldSignal =
  | { kind: "location"; at: Instant; technicianId: string; pos: GeoPoint }
  | { kind: "departed"; at: Instant; technicianId: string; jobId: string; pos: GeoPoint }
  | { kind: "eta"; at: Instant; technicianId: string; jobId: string; arrivalEta: Instant }
  | { kind: "arrived"; at: Instant; technicianId: string; jobId: string; pos: GeoPoint }
  | { kind: "status"; at: Instant; technicianId: string; jobId: string; status: string };

export interface DriveRequest {
  technicianId: string;
  jobId: string;
  from: GeoPoint;
  to: GeoPoint;
  departAt: Instant;
  opts?: TravelOptions;
  /** Optional interim location pings; count of evenly-spaced samples between depart and arrive. */
  locationPings?: number;
}

export interface DrivePlan {
  technicianId: string;
  jobId: string;
  departedAt: Instant;
  arrivalEta: Instant;
  arrivedAt: Instant;
  distanceKm: number;
  /** The full signal timeline, ordered by `at` (departed → eta → location pings → arrived). */
  signals: MobileFieldSignal[];
}

/**
 * Deterministically compute the signal timeline for a technician driving to a
 * job site. This is the harness stub of the mobile contract: the same stream the
 * real device would emit, derived from geo-temporal math + the departure instant.
 */
export function planDrive(req: DriveRequest): DrivePlan {
  const { technicianId, jobId, from, to, departAt, opts } = req;
  const distanceKm = geoDistanceKm(from, to);
  const arrivalEta = etaAt(departAt, from, to, opts);
  const arrivedAt = arrivalEta; // deterministic stub: ETA is the arrival

  const signals: MobileFieldSignal[] = [
    { kind: "departed", at: departAt, technicianId, jobId, pos: from },
    { kind: "eta", at: departAt, technicianId, jobId, arrivalEta },
  ];

  const pings = Math.max(0, Math.floor(req.locationPings ?? 0));
  const travelMs = arrivedAt - departAt;
  for (let i = 1; i <= pings; i++) {
    const frac = i / (pings + 1);
    signals.push({
      kind: "location",
      at: departAt + Math.round(travelMs * frac),
      technicianId,
      pos: { lat: from.lat + (to.lat - from.lat) * frac, lng: from.lng + (to.lng - from.lng) * frac },
    });
  }

  signals.push({ kind: "arrived", at: arrivedAt, technicianId, jobId, pos: to });
  signals.sort((a, b) => a.at - b.at);
  return { technicianId, jobId, departedAt: departAt, arrivalEta, arrivedAt, distanceKm, signals };
}

/**
 * Whether a planned arrival is "running late" relative to a promised window end.
 * The dispatcher uses this to fire the running-late cascade (drives O3).
 */
export function isRunningLate(arrivalEta: Instant, promisedBy: Instant, graceMinutes = 0): boolean {
  return arrivalEta > promisedBy + Math.round(graceMinutes * 60_000);
}

/** Re-export so callers can compute their own travel times against the contract. */
export { travelTimeMinutes };
