import { describe, expect, it } from "vitest";

import {
  LOCAL_CI_POOL_STALLED_ISSUE_KEY,
  assessLocalCiPoolLiveness,
  type LocalCiLeaseLivenessRow,
} from "./local-ci-pool-liveness";

const NOW = new Date("2026-09-02T05:00:00.000Z");
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000);

function lease(over: Partial<LocalCiLeaseLivenessRow>): LocalCiLeaseLivenessRow {
  return {
    leaseId: "NPEL-1",
    admittedAt: minutesAgo(30),
    releasedAt: minutesAgo(20),
    evidenceRecordId: null,
    status: "released",
    ...over,
  };
}

describe("assessLocalCiPoolLiveness (BI-277ECBDB C)", () => {
  it("is degraded when admissions in the window end with no recorded result and none completed", () => {
    // The 2026-09-02 incident: six leases cycled for an hour, zero results.
    const leases = [1, 2, 3, 4, 5, 6].map((n) => lease({ leaseId: `NPEL-${n}`, admittedAt: minutesAgo(10 * n) }));
    const verdict = assessLocalCiPoolLiveness({ leases, now: NOW });
    expect(verdict.degraded).toBe(true);
    expect(verdict.admittedWithoutResult).toBe(6);
    expect(verdict.completed).toBe(0);
    expect(verdict.summary).toMatch(/6 local-CI admissions .* no recorded result/);
  });

  it("one completed run in the window proves the pool works", () => {
    const leases = [
      lease({ leaseId: "a" }), lease({ leaseId: "b" }), lease({ leaseId: "c" }),
      lease({ leaseId: "d", evidenceRecordId: "ev-1" }),
    ];
    expect(assessLocalCiPoolLiveness({ leases, now: NOW }).degraded).toBe(false);
  });

  it("does not count a lease still in flight, or one admitted before the window", () => {
    const leases = [
      lease({ leaseId: "live", releasedAt: null, status: "active" }),
      lease({ leaseId: "old-1", admittedAt: minutesAgo(200) }),
      lease({ leaseId: "old-2", admittedAt: minutesAgo(300) }),
      lease({ leaseId: "old-3", admittedAt: minutesAgo(400) }),
      lease({ leaseId: "recent" }),
    ];
    const verdict = assessLocalCiPoolLiveness({ leases, now: NOW });
    expect(verdict.admittedWithoutResult).toBe(1);
    expect(verdict.degraded).toBe(false);
  });

  it("a cancelled wait that never ran is not a stalled admission", () => {
    const leases = [1, 2, 3].map((n) => lease({ leaseId: `q-${n}`, admittedAt: null, status: "cancelled" }));
    expect(assessLocalCiPoolLiveness({ leases, now: NOW }).admittedWithoutResult).toBe(0);
  });

  it("names one stable issue key", () => {
    expect(LOCAL_CI_POOL_STALLED_ISSUE_KEY).toBe("local-ci:pool-admissions-without-results");
  });
});
