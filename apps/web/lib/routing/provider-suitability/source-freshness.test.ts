// BI-68D44727 — tests for the compliance-source freshness horizon.
//
// EVERY case here pins the clock. This module is ABOUT expiry dates, so an
// unpinned assertion would be precisely the defect the module exists to warn
// about — a test that passes today and fails on a date nobody wrote down.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  COMPLIANCE_SOURCE_EXPIRY_WARNING_DAYS,
  summarizeComplianceSourceFreshness,
} from "./source-freshness";

// The shipped registry retrieved every source on 2026-07-20. The three
// provider-terms sources carry maxAgeDays 60 → stale from 2026-09-18.
const BEFORE_ANY_EXPIRY = "2026-08-05T12:00:00.000Z";
const INSIDE_WARNING_WINDOW = "2026-09-01T12:00:00.000Z"; // 17 days before the 60d cliff
const AFTER_60D_EXPIRY = "2026-09-19T12:00:00.000Z";

function pin(instant: string) {
  beforeEach(() => vi.useFakeTimers().setSystemTime(instant));
  afterEach(() => vi.useRealTimers());
}

describe("summarizeComplianceSourceFreshness", () => {
  describe("well before any expiry", () => {
    pin(BEFORE_ANY_EXPIRY);

    it("reports every source fresh and warns about nothing", () => {
      const summary = summarizeComplianceSourceFreshness();
      expect(summary.stale).toEqual([]);
      expect(summary.expiringSoon).toEqual([]);
      expect(summary.worst).toBe("fresh");
      expect(summary.sources.length).toBeGreaterThan(0);
      expect(summary.sources.every((s) => s.status === "fresh")).toBe(true);
    });

    it("counts days remaining from the source's own window, not a global default", () => {
      const summary = summarizeComplianceSourceFreshness();
      const short = summary.sources.find((s) => s.maxAgeDays === 60);
      const long = summary.sources.find((s) => s.maxAgeDays === 365);
      // 2026-07-20 + 60d = 2026-09-18; from 2026-08-05 that is 44 days out.
      expect(short?.daysUntilStale).toBe(44);
      expect(long?.daysUntilStale).toBe(349);
    });
  });

  describe("inside the warning window", () => {
    pin(INSIDE_WARNING_WINDOW);

    it("flags the 60-day provider terms as expiring soon while they are still valid", () => {
      const summary = summarizeComplianceSourceFreshness();
      expect(summary.stale).toEqual([]);
      expect(summary.worst).toBe("expiring-soon");
      expect(summary.expiringSoon.length).toBe(3);
      // Still usable — the point of warning early is that nothing has broken yet.
      expect(summary.expiringSoon.every((s) => s.daysUntilStale > 0)).toBe(true);
      expect(summary.expiringSoon.every((s) => s.sourceType === "provider-terms")).toBe(true);
    });

    it("leaves the long-window regulatory sources alone", () => {
      const summary = summarizeComplianceSourceFreshness();
      expect(summary.expiringSoon.some((s) => s.maxAgeDays === 365)).toBe(false);
    });
  });

  describe("after the 60-day sources lapse", () => {
    pin(AFTER_60D_EXPIRY);

    it("reports them stale, which is when advisories stop substantiating", () => {
      const summary = summarizeComplianceSourceFreshness();
      expect(summary.worst).toBe("stale");
      expect(summary.stale.length).toBe(3);
      expect(summary.stale.every((s) => s.daysUntilStale < 0)).toBe(true);
    });

    it("does not double-report a stale source as also expiring soon", () => {
      const summary = summarizeComplianceSourceFreshness();
      const staleKeys = new Set(summary.stale.map((s) => s.sourceKey));
      expect(summary.expiringSoon.some((s) => staleKeys.has(s.sourceKey))).toBe(false);
    });
  });

  describe("boundary — the exact instant a window closes", () => {
    // maxAgeDays is a whole-day allowance, so a source is still valid THROUGH
    // its final day. Asserting the boundary explicitly stops an off-by-one from
    // silently moving the alert a day early or a day late.
    pin("2026-09-18T12:00:00.000Z");

    it("treats the final day of the window as still valid", () => {
      const summary = summarizeComplianceSourceFreshness();
      expect(summary.stale).toEqual([]);
      expect(summary.sources.find((s) => s.maxAgeDays === 60)?.daysUntilStale).toBe(0);
    });
  });

  describe("caller-supplied instant", () => {
    pin(BEFORE_ANY_EXPIRY);

    it("honours an explicit `now`, so callers can project a future horizon", () => {
      const summary = summarizeComplianceSourceFreshness({ now: new Date(AFTER_60D_EXPIRY) });
      expect(summary.worst).toBe("stale");
    });
  });

  it("exports a warning window long enough to act on a compliance review", () => {
    // The renewal is a human re-reading vendor policy pages, not a scrape, so
    // the lead time has to be weeks rather than days.
    expect(COMPLIANCE_SOURCE_EXPIRY_WARNING_DAYS).toBeGreaterThanOrEqual(14);
  });
});
