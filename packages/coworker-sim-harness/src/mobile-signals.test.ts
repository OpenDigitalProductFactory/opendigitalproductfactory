import { describe, expect, it } from "vitest";

import type { GeoPoint } from "./geo-temporal";
import { type MobileFieldSignal, isRunningLate, planDrive } from "./mobile-signals";
import { HOUR } from "./virtual-clock";

const DEPOT: GeoPoint = { lat: 30.27, lng: -97.74 }; // Austin-ish
const SITE: GeoPoint = { lat: 30.4, lng: -97.7 };

describe("planDrive", () => {
  it("emits departed → eta → arrived as one ordered signal stream", () => {
    const plan = planDrive({ technicianId: "T1", jobId: "J1", from: DEPOT, to: SITE, departAt: 0 });
    const kinds = plan.signals.map((s) => s.kind);
    expect(kinds[0]).toBe("departed");
    expect(kinds).toContain("eta");
    expect(kinds[kinds.length - 1]).toBe("arrived");
    // ordered by time, non-decreasing
    const times = plan.signals.map((s) => s.at);
    expect([...times].sort((a, b) => a - b)).toEqual(times);
    // arrival equals the ETA in the deterministic stub
    expect(plan.arrivedAt).toBe(plan.arrivalEta);
    expect(plan.distanceKm).toBeGreaterThan(0);
  });

  it("carries the ETA instant on the eta signal", () => {
    const plan = planDrive({ technicianId: "T1", jobId: "J1", from: DEPOT, to: SITE, departAt: 1000 });
    const eta = plan.signals.find((s): s is Extract<MobileFieldSignal, { kind: "eta" }> => s.kind === "eta");
    expect(eta?.arrivalEta).toBe(plan.arrivalEta);
  });

  it("inserts the requested number of interim location pings, between depart and arrive", () => {
    const plan = planDrive({ technicianId: "T1", jobId: "J1", from: DEPOT, to: SITE, departAt: 0, locationPings: 3 });
    const locs = plan.signals.filter((s) => s.kind === "location");
    expect(locs).toHaveLength(3);
    for (const loc of locs) {
      expect(loc.at).toBeGreaterThan(plan.departedAt);
      expect(loc.at).toBeLessThan(plan.arrivedAt);
    }
  });
});

describe("isRunningLate", () => {
  it("is true when ETA slips past the promised window (beyond grace)", () => {
    const promisedBy = 2 * HOUR;
    expect(isRunningLate(promisedBy + 20 * 60_000, promisedBy)).toBe(true);
    expect(isRunningLate(promisedBy - 5 * 60_000, promisedBy)).toBe(false);
    // within grace is not late
    expect(isRunningLate(promisedBy + 5 * 60_000, promisedBy, 10)).toBe(false);
  });
});
