import { describe, expect, it } from "vitest";

import {
  rationReservations,
  wouldGrant,
  type RationRequest,
} from "./rental-rationing";

const d = (iso: string) => new Date(iso);

const req = (
  requestRef: string,
  memberId: string,
  requestedAt: string,
  start = "2026-07-01",
  end = "2026-07-03",
): RationRequest => ({
  requestRef,
  memberId,
  requestedAt: d(requestedAt),
  periodStart: d(start),
  periodEnd: d(end),
});

describe("rationReservations — equitable allocation", () => {
  it("prioritises the least-served member over first-come ordering", () => {
    // m-heavy requested FIRST but has high recent usage; m-light should win the
    // single available slot despite requesting later. This is the whole point:
    // a member pool is not first-come-first-served.
    const requests = [
      req("r1", "m-heavy", "2026-06-01T08:00:00Z"),
      req("r2", "m-light", "2026-06-01T09:00:00Z"),
    ];
    const out = rationReservations(requests, {
      capacity: 1,
      maxConcurrentPerMember: 5,
      recentUsage: { "m-heavy": 40, "m-light": 2 },
    });
    expect(out.granted.map((g) => g.requestRef)).toEqual(["r2"]);
    const wl = out.waitlisted[0];
    expect(wl.requestRef).toBe("r1");
    expect(wl.status === "waitlisted" && wl.reason).toBe("capacity-exhausted");
  });

  it("falls back to earlier request time when usage is equal", () => {
    const requests = [
      req("late", "m2", "2026-06-01T10:00:00Z"),
      req("early", "m1", "2026-06-01T08:00:00Z"),
    ];
    const out = rationReservations(requests, {
      capacity: 1,
      maxConcurrentPerMember: 5,
      recentUsage: { m1: 5, m2: 5 },
    });
    expect(out.granted.map((g) => g.requestRef)).toEqual(["early"]);
  });

  it("enforces a per-member concurrency cap", () => {
    // One member floods the pool; the cap reserves capacity for others.
    const requests = [
      req("a1", "m1", "2026-06-01T08:00:00Z", "2026-07-01", "2026-07-03"),
      req("a2", "m1", "2026-06-01T08:05:00Z", "2026-07-04", "2026-07-06"),
      req("b1", "m2", "2026-06-01T09:00:00Z", "2026-07-01", "2026-07-03"),
    ];
    const out = rationReservations(requests, {
      capacity: 5,
      maxConcurrentPerMember: 1,
      recentUsage: { m1: 0, m2: 0 },
    });
    const granted = out.granted.map((g) => g.requestRef).sort();
    expect(granted).toEqual(["a1", "b1"]); // m1's second request capped
    const capped = out.waitlisted.find((w) => w.requestRef === "a2");
    expect(capped && capped.status === "waitlisted" && capped.reason).toBe(
      "member-cap-reached",
    );
  });

  it("grants non-overlapping windows beyond nominal capacity", () => {
    // Capacity 1, but the two requests don't overlap in time, so both fit.
    const requests = [
      req("w1", "m1", "2026-06-01T08:00:00Z", "2026-07-01", "2026-07-03"),
      req("w2", "m2", "2026-06-01T09:00:00Z", "2026-07-10", "2026-07-12"),
    ];
    const out = rationReservations(requests, {
      capacity: 1,
      maxConcurrentPerMember: 5,
    });
    expect(out.granted).toHaveLength(2);
  });

  it("counts pre-existing occupying agreements against capacity", () => {
    const requests = [req("r1", "m1", "2026-06-01T08:00:00Z")];
    const out = rationReservations(requests, {
      capacity: 1,
      maxConcurrentPerMember: 5,
      existing: [
        { status: "active", periodStart: d("2026-06-30"), periodEnd: d("2026-07-02") },
      ],
    });
    expect(out.granted).toHaveLength(0);
    expect(out.waitlisted[0].status === "waitlisted" && out.waitlisted[0].reason).toBe(
      "capacity-exhausted",
    );
  });

  it("is deterministic — identical inputs yield identical ordering", () => {
    const build = () => [
      req("r1", "m1", "2026-06-01T08:00:00Z"),
      req("r2", "m2", "2026-06-01T08:00:00Z"),
      req("r3", "m3", "2026-06-01T08:00:00Z"),
    ];
    const cfg = { capacity: 2, maxConcurrentPerMember: 5 };
    const a = rationReservations(build(), cfg);
    const b = rationReservations(build(), cfg);
    expect(a.decisions).toEqual(b.decisions);
  });
});

describe("wouldGrant", () => {
  it("is true when capacity remains for the window", () => {
    expect(
      wouldGrant(req("r1", "m1", "2026-06-01T08:00:00Z"), { capacity: 1, maxConcurrentPerMember: 5 }),
    ).toBe(true);
  });
  it("is false when an overlapping agreement saturates capacity", () => {
    expect(
      wouldGrant(req("r1", "m1", "2026-06-01T08:00:00Z"), {
        capacity: 1,
        maxConcurrentPerMember: 5,
        existing: [{ status: "reserved", periodStart: d("2026-06-30"), periodEnd: d("2026-07-02") }],
      }),
    ).toBe(false);
  });
});
