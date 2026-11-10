import { describe, expect, it } from "vitest";

import {
  leaseStillProvesLiveness,
  listCapacityReservingNonprodEnvironmentLeases,
} from "./environment-lease-registry";

const NOW = new Date("2026-09-02T04:19:07.000Z");
const at = (iso: string) => new Date(iso);

// BI-DC9CA20D. Measured on the live install 2026-09-02 at 04:19: six queued
// local-CI leases, ZERO active, every one with heartbeatAt EXACTLY equal to
// queuedAt — not one renewal — and staleness from 10 to 53 minutes. Their
// owning sessions were gone, so nothing was left to admit them, and they were
// set to occupy the queue for two hours against a declared TTL of ~2 minutes.
//
// local-provider-capacity defers local inference whenever any lease reserves
// the host, and dead rows arrived roughly every 7 minutes against a 2-hour
// decay. The queue therefore could never empty: a permanent outage of the
// platform's own AI, and the reason governed reviewer dispatches were starved.
const DEAD_WAITERS = [
  { leaseId: "NPEL-0BFCE35A0D", queuedAt: at("2026-09-02T03:25:59.000Z") },
  { leaseId: "NPEL-9742BE705D", queuedAt: at("2026-09-02T03:26:12.000Z") },
  { leaseId: "NPEL-088F40091E", queuedAt: at("2026-09-02T03:44:53.000Z") },
  { leaseId: "NPEL-E42846763F", queuedAt: at("2026-09-02T03:47:28.000Z") },
  { leaseId: "NPEL-5FF6215312", queuedAt: at("2026-09-02T04:06:06.000Z") },
  { leaseId: "NPEL-19CB8E7052", queuedAt: at("2026-09-02T04:08:55.000Z") },
].map((row) => ({
  ...row,
  status: "queued" as const,
  // The signature: heartbeat never advanced past the moment it was queued.
  heartbeatAt: row.queuedAt,
  requestedTtlMs: 118_662,
  // Two hours out, 60x the declared TTL — which is why expiry alone never freed the host.
  expiresAt: new Date(row.queuedAt.getTime() + 2 * 60 * 60 * 1000),
}));

function dbReturning(rows: unknown[]) {
  return {
    nonProductionEnvironmentLease: {
      findMany: async () => rows,
    },
  } as never;
}

describe("a capacity reservation is only as good as its last proof of life (BI-DC9CA20D)", () => {
  it("stops the six measured dead waiters from reserving the host", async () => {
    const reserving = await listCapacityReservingNonprodEnvironmentLeases({
      db: dbReturning(DEAD_WAITERS),
      now: NOW,
    });
    // Before this fix all six reserved the host for two hours apiece, and
    // local inference was deferred the entire time.
    expect(reserving).toEqual([]);
  });

  it("keeps a live waiter reserving, so a slow queue is never robbed of its slot", async () => {
    const live = {
      leaseId: "NPEL-LIVE",
      status: "queued" as const,
      queuedAt: at("2026-09-02T03:25:59.000Z"),
      // Renewed 40s ago — this is what a live waiter looks like.
      heartbeatAt: new Date(NOW.getTime() - 40_000),
      requestedTtlMs: 118_662,
      expiresAt: new Date(NOW.getTime() + 60_000),
    };
    const reserving = await listCapacityReservingNonprodEnvironmentLeases({
      db: dbReturning([live, ...DEAD_WAITERS]),
      now: NOW,
    });
    expect(reserving.map((row) => (row as { leaseId: string }).leaseId)).toEqual(["NPEL-LIVE"]);
  });

  it("keeps an ACTIVE lease reserving while it heartbeats", async () => {
    // The running gate genuinely owns the host; nothing here may evict it.
    const active = {
      leaseId: "NPEL-ACTIVE",
      status: "active" as const,
      queuedAt: at("2026-09-02T03:00:00.000Z"),
      heartbeatAt: new Date(NOW.getTime() - 30_000),
      requestedTtlMs: 120_000,
      expiresAt: new Date(NOW.getTime() + 90_000),
    };
    const reserving = await listCapacityReservingNonprodEnvironmentLeases({
      db: dbReturning([active]),
      now: NOW,
    });
    expect(reserving).toHaveLength(1);
  });

  it("does not reap a row that was only just written and has not had time to renew", () => {
    expect(leaseStillProvesLiveness(
      { queuedAt: NOW, heartbeatAt: null, requestedTtlMs: 118_662 },
      NOW,
    )).toBe(true);
  });

  it("allows three missed renewals before disbelieving a lease", () => {
    const ttl = 60_000;
    const beatsAgo = (ms: number) => ({ heartbeatAt: new Date(NOW.getTime() - ms), requestedTtlMs: ttl });
    // Grace is deliberate: a genuinely slow host must not lose its reservation.
    expect(leaseStillProvesLiveness(beatsAgo(2 * ttl), NOW)).toBe(true);
    expect(leaseStillProvesLiveness(beatsAgo(3 * ttl - 1), NOW)).toBe(true);
    expect(leaseStillProvesLiveness(beatsAgo(3 * ttl + 1), NOW)).toBe(false);
  });

  it("floors the liveness window so an implausibly short TTL cannot self-reap", () => {
    // A lease declaring a 1s TTL would otherwise be disbelieved 3s later.
    expect(leaseStillProvesLiveness(
      { heartbeatAt: new Date(NOW.getTime() - 60_000), requestedTtlMs: 1_000 },
      NOW,
    )).toBe(true);
  });

  it("treats a lease with no timestamps at all as unproven", () => {
    expect(leaseStillProvesLiveness({}, NOW)).toBe(false);
  });
});
