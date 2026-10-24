import { describe, expect, it } from "vitest";

// BI-D35B85BF Wanted 3 — a queued row whose owner stopped beating is reaped
// now, instead of holding its reservation until its two-hour wait deadline.

import {
  ABANDONED_QUEUE_ROW_AFTER_MS,
  planEnvironmentAdmission,
  queueRowIsAbandoned,
  type AdmissionLease,
} from "./environment-lease-admission";

const NOW = new Date("2026-09-12T04:00:00.000Z");
const WAIT_DEADLINE = new Date(NOW.getTime() + 2 * 60 * 60_000);

function queued(overrides: Partial<AdmissionLease> = {}): AdmissionLease {
  return {
    id: "row-queued",
    status: "queued",
    slotKey: null,
    queuedAt: new Date(NOW.getTime() - 60_000),
    heartbeatAt: new Date(NOW.getTime() - 60_000),
    expiresAt: WAIT_DEADLINE,
    ...overrides,
  };
}

const minutesAgo = (n: number) => new Date(NOW.getTime() - n * 60_000);

describe("abandoned queue rows", () => {
  it("reaps a queued row whose owner stopped beating", () => {
    const lease = queued({ heartbeatAt: minutesAgo(55) });
    expect(queueRowIsAbandoned(lease, NOW, ABANDONED_QUEUE_ROW_AFTER_MS)).toBe(true);
  });

  it("keeps a waiter that merely missed a few re-claims on a busy host", () => {
    const lease = queued({ heartbeatAt: minutesAgo(3) });
    expect(queueRowIsAbandoned(lease, NOW, ABANDONED_QUEUE_ROW_AFTER_MS)).toBe(false);
  });

  it("falls back to queuedAt when no beat was ever recorded", () => {
    const lease = queued({ heartbeatAt: null, queuedAt: minutesAgo(55) });
    expect(queueRowIsAbandoned(lease, NOW, ABANDONED_QUEUE_ROW_AFTER_MS)).toBe(true);
  });

  it("never reaps an ACTIVE row - its TTL governs it, not this rule", () => {
    const lease = queued({ status: "active", slotKey: "slot-0", heartbeatAt: minutesAgo(55) });
    expect(queueRowIsAbandoned(lease, NOW, ABANDONED_QUEUE_ROW_AFTER_MS)).toBe(false);
  });

  it("does nothing at all for an environment that does not opt in", () => {
    const lease = queued({ heartbeatAt: minutesAgo(55) });
    expect(queueRowIsAbandoned(lease, NOW, undefined)).toBe(false);
  });

  // The window has to clear the cadence it is judging, or a live waiter is
  // reaped mid-wait - a far worse failure than the reservation it reclaims.
  it("leaves generous headroom over the resumer's re-claim cadence", () => {
    expect(ABANDONED_QUEUE_ROW_AFTER_MS).toBeGreaterThanOrEqual(10 * 60_000);
  });
});

describe("admission with abandoned rows", () => {
  const plan = (leases: AdmissionLease[], abandonedWaiterAfterMs?: number) =>
    planEnvironmentAdmission({
      leases,
      now: NOW,
      slotKeys: ["slot-0", "slot-1"],
      abandonedWaiterAfterMs,
    });

  it("expires the abandoned row and leaves the live one queued", () => {
    const abandoned = queued({ id: "row-abandoned", heartbeatAt: minutesAgo(55) });
    const live = queued({ id: "row-live", queuedAt: minutesAgo(5), heartbeatAt: minutesAgo(1) });

    const result = plan([abandoned, live], ABANDONED_QUEUE_ROW_AFTER_MS);

    expect(result.expiredLeaseIds).toContain("row-abandoned");
    expect(result.expiredLeaseIds).not.toContain("row-live");
  });

  it("an expired row does not keep its place in the queue", () => {
    const abandoned = queued({ id: "row-abandoned", queuedAt: minutesAgo(60), heartbeatAt: minutesAgo(55) });
    const live = queued({ id: "row-live", queuedAt: minutesAgo(5), heartbeatAt: minutesAgo(1) });

    const positions = plan([abandoned, live], ABANDONED_QUEUE_ROW_AFTER_MS).queuePositions;

    expect(positions.some((entry) => entry.leaseId === "row-abandoned")).toBe(false);
  });

  // Back-compat: every existing caller passes no window, and must be unchanged.
  it("reaps nothing when no window is supplied", () => {
    const abandoned = queued({ id: "row-abandoned", heartbeatAt: minutesAgo(55) });
    expect(plan([abandoned]).expiredLeaseIds).toEqual([]);
  });

  it("still expires on the wait deadline regardless of the window", () => {
    const past = queued({ id: "row-past-deadline", expiresAt: minutesAgo(1) });
    expect(plan([past]).expiredLeaseIds).toContain("row-past-deadline");
  });
});
