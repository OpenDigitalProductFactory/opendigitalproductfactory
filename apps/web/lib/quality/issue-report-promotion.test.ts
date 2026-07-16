import { describe, expect, it } from "vitest";
import {
  shouldPromoteIssueReport,
  shouldExpireStagedReport,
  REACH_OCCURRENCE_THRESHOLD,
  SCAN_WINDOW_MS,
  RECENCY_MS,
  STAGING_STALE_MS,
} from "./issue-report-promotion";

// A fixed evaluation instant so every case is deterministic.
const NOW = new Date("2026-07-16T12:00:00.000Z");
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60 * 1000);

describe("shouldPromoteIssueReport (BI-51F6A428)", () => {
  describe("high/critical always promote on first occurrence", () => {
    for (const severity of ["high", "critical", "HIGH", "Critical"]) {
      it(`promotes ${severity} at occurrenceCount=1 with no accrual history`, () => {
        expect(
          shouldPromoteIssueReport({
            occurrenceCount: 1,
            firstSeenAt: NOW,
            lastSeenAt: NOW,
            severity,
            now: NOW,
          }),
        ).toBe(true);
      });
    }

    it("promotes critical even when the reach/span/recency bars would all fail", () => {
      expect(
        shouldPromoteIssueReport({
          occurrenceCount: 1,
          firstSeenAt: minutesAgo(1),
          lastSeenAt: minutesAgo(1),
          severity: "critical",
          now: NOW,
        }),
      ).toBe(true);
    });
  });

  describe("low/medium below the reach bar are held (staged)", () => {
    it("holds a low first occurrence (occurrenceCount=1)", () => {
      expect(
        shouldPromoteIssueReport({
          occurrenceCount: 1,
          firstSeenAt: NOW,
          lastSeenAt: NOW,
          severity: "low",
          now: NOW,
        }),
      ).toBe(false);
    });

    it("holds a medium signal seen twice (still below the reach threshold of 3)", () => {
      expect(
        shouldPromoteIssueReport({
          occurrenceCount: REACH_OCCURRENCE_THRESHOLD - 1,
          firstSeenAt: minutesAgo(40),
          lastSeenAt: minutesAgo(2),
          severity: "medium",
          now: NOW,
        }),
      ).toBe(false);
    });

    it("holds when reach is met but the first→last span is a single-window burst", () => {
      // occurrenceCount high, but every sighting arrived within one scan window.
      expect(
        shouldPromoteIssueReport({
          occurrenceCount: 10,
          firstSeenAt: minutesAgo(5),
          lastSeenAt: minutesAgo(4),
          severity: "low",
          now: NOW,
        }),
      ).toBe(false);
    });

    it("holds (fails closed) when accrual timestamps are missing", () => {
      expect(
        shouldPromoteIssueReport({
          occurrenceCount: 5,
          firstSeenAt: null,
          lastSeenAt: null,
          severity: "medium",
          now: NOW,
        }),
      ).toBe(false);
    });
  });

  describe("low/medium above the reach + recency bar promote", () => {
    it("promotes a low signal seen >=3 times across >=2 windows and still recurring", () => {
      expect(
        shouldPromoteIssueReport({
          occurrenceCount: REACH_OCCURRENCE_THRESHOLD,
          firstSeenAt: minutesAgo(40), // > MIN_SPAN_MS (15m) before last
          lastSeenAt: minutesAgo(2), // within RECENCY_MS
          severity: "low",
          now: NOW,
        }),
      ).toBe(true);
    });

    it("promotes exactly at the span boundary (span === MIN_SPAN_MS)", () => {
      const last = minutesAgo(2);
      const first = new Date(last.getTime() - SCAN_WINDOW_MS);
      expect(
        shouldPromoteIssueReport({
          occurrenceCount: REACH_OCCURRENCE_THRESHOLD,
          firstSeenAt: first,
          lastSeenAt: last,
          severity: "medium",
          now: NOW,
        }),
      ).toBe(true);
    });
  });

  describe("recency expiry — reached the bar then stopped recurring", () => {
    it("does NOT promote a low signal whose last sighting is older than the recency window", () => {
      const last = new Date(NOW.getTime() - RECENCY_MS - 60 * 1000); // just past recency
      expect(
        shouldPromoteIssueReport({
          occurrenceCount: 8,
          firstSeenAt: new Date(last.getTime() - 3 * SCAN_WINDOW_MS),
          lastSeenAt: last,
          severity: "low",
          now: NOW,
        }),
      ).toBe(false);
    });
  });
});

describe("shouldExpireStagedReport (BI-51F6A428 aging-out)", () => {
  it("expires a staged report not seen within the stale window", () => {
    expect(
      shouldExpireStagedReport({
        firstSeenAt: new Date(NOW.getTime() - 3 * STAGING_STALE_MS),
        lastSeenAt: new Date(NOW.getTime() - STAGING_STALE_MS - 60 * 1000),
        now: NOW,
      }),
    ).toBe(true);
  });

  it("does NOT expire a staged report still recurring within the stale window", () => {
    expect(
      shouldExpireStagedReport({
        firstSeenAt: minutesAgo(90),
        lastSeenAt: minutesAgo(5),
        now: NOW,
      }),
    ).toBe(false);
  });

  it("falls back to firstSeenAt when lastSeenAt is missing", () => {
    expect(
      shouldExpireStagedReport({
        firstSeenAt: new Date(NOW.getTime() - STAGING_STALE_MS - 60 * 1000),
        lastSeenAt: null,
        now: NOW,
      }),
    ).toBe(true);
  });

  it("does NOT expire (fail-safe) when no sighting timestamps exist at all", () => {
    expect(
      shouldExpireStagedReport({ firstSeenAt: null, lastSeenAt: null, now: NOW }),
    ).toBe(false);
  });
});
