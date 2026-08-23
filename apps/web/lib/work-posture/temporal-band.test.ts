import { describe, expect, it } from "vitest";

import {
  DAMPING_EXEMPT_ACTIVITY_FAMILIES,
  DEFAULT_DEADLINE_WARNING_MINUTES,
  isDampingExempt,
  resolveTemporalBand,
  TEMPORAL_BANDS,
} from "./temporal-band";
import type { WeeklySchedule } from "@/lib/operating-hours-types";

const NINE_TO_FIVE: WeeklySchedule = {
  monday: { enabled: true, open: "09:00", close: "17:00" },
  tuesday: { enabled: true, open: "09:00", close: "17:00" },
  wednesday: { enabled: true, open: "09:00", close: "17:00" },
  thursday: { enabled: true, open: "09:00", close: "17:00" },
  friday: { enabled: true, open: "09:00", close: "17:00" },
  saturday: { enabled: false, open: "09:00", close: "17:00" },
  sunday: { enabled: false, open: "09:00", close: "17:00" },
};

const CLOSED_ALL_WEEK: WeeklySchedule = {
  monday: { enabled: false, open: "09:00", close: "17:00" },
  tuesday: { enabled: false, open: "09:00", close: "17:00" },
  wednesday: { enabled: false, open: "09:00", close: "17:00" },
  thursday: { enabled: false, open: "09:00", close: "17:00" },
  friday: { enabled: false, open: "09:00", close: "17:00" },
  saturday: { enabled: false, open: "09:00", close: "17:00" },
  sunday: { enabled: false, open: "09:00", close: "17:00" },
};

// 2026-08-19 is a Wednesday. Times below are UTC and the schedule is read in UTC
// unless a test pins another zone.
const WED_1000 = new Date("2026-08-19T10:00:00Z");
const WED_2200 = new Date("2026-08-19T22:00:00Z");
const SAT_1000 = new Date("2026-08-22T10:00:00Z");

describe("resolveTemporalBand", () => {
  it("resolves in-hours inside the operating window", () => {
    const result = resolveTemporalBand({
      now: WED_1000,
      schedule: NINE_TO_FIVE,
      timezone: "UTC",
    });
    expect(result.band).toBe("in-hours");
    expect(result.reasonCode).toBe("within_operating_hours");
  });

  it("resolves out-of-hours outside the operating window", () => {
    const result = resolveTemporalBand({
      now: WED_2200,
      schedule: NINE_TO_FIVE,
      timezone: "UTC",
    });
    expect(result.band).toBe("out-of-hours");
  });

  it("resolves out-of-hours on a disabled day", () => {
    expect(
      resolveTemporalBand({ now: SAT_1000, schedule: NINE_TO_FIVE, timezone: "UTC" }).band,
    ).toBe("out-of-hours");
  });

  it("resolves out-of-hours for a closed-all-week schedule", () => {
    expect(
      resolveTemporalBand({ now: WED_1000, schedule: CLOSED_ALL_WEEK, timezone: "UTC" }).band,
    ).toBe("out-of-hours");
  });

  it("resolves low-traffic when a trough falls inside opening hours", () => {
    const result = resolveTemporalBand({
      now: WED_1000,
      schedule: NINE_TO_FIVE,
      timezone: "UTC",
      lowTrafficWindows: [{ dayOfWeek: 3, start: "09:30", end: "11:00" }],
    });
    expect(result.band).toBe("low-traffic");
    expect(result.lowTraffic).toBe(true);
  });

  it("CLOSED outranks CHEAP, while still reporting the trough", () => {
    // The defect this guards, found against live data 2026-08-22: this install's
    // troughs are the exact complement of its business hours, so ranking
    // low-traffic above out-of-hours meant "the business is closed" never damped
    // immediacy anywhere. Closed is the immediacy answer; cheap rides alongside.
    const result = resolveTemporalBand({
      now: WED_2200,
      schedule: NINE_TO_FIVE,
      timezone: "UTC",
      lowTrafficWindows: [{ dayOfWeek: 3, start: "17:00", end: "23:59" }],
    });
    expect(result.band).toBe("out-of-hours");
    expect(result.lowTraffic).toBe(true);
  });

  it("reports lowTraffic false outside any trough", () => {
    expect(
      resolveTemporalBand({ now: WED_1000, schedule: NINE_TO_FIVE, timezone: "UTC" }).lowTraffic,
    ).toBe(false);
  });

  it("resolves pre-deadline inside the warning window, beating the operating clock", () => {
    // Closed (22:00) but due in 2h — the obligation does not stop being due
    // because the office is shut.
    const result = resolveTemporalBand({
      now: WED_2200,
      schedule: NINE_TO_FIVE,
      timezone: "UTC",
      dueAt: new Date("2026-08-20T00:00:00Z"),
    });
    expect(result.band).toBe("pre-deadline");
  });

  it("resolves breach-imminent at or past the due time", () => {
    expect(
      resolveTemporalBand({
        now: WED_1000,
        schedule: NINE_TO_FIVE,
        timezone: "UTC",
        dueAt: WED_1000,
      }).band,
    ).toBe("breach-imminent");
  });

  it("does not open the pre-deadline band outside the warning window", () => {
    const wellBeyond = new Date(
      WED_1000.getTime() + (DEFAULT_DEADLINE_WARNING_MINUTES + 60) * 60_000,
    );
    expect(
      resolveTemporalBand({
        now: WED_1000,
        schedule: NINE_TO_FIVE,
        timezone: "UTC",
        dueAt: wellBeyond,
      }).band,
    ).toBe("in-hours");
  });

  it("reaches every declared band", () => {
    const reached = new Set([
      resolveTemporalBand({ now: WED_1000, schedule: NINE_TO_FIVE, timezone: "UTC" }).band,
      resolveTemporalBand({ now: WED_2200, schedule: NINE_TO_FIVE, timezone: "UTC" }).band,
      resolveTemporalBand({
        now: WED_1000,
        schedule: NINE_TO_FIVE,
        timezone: "UTC",
        lowTrafficWindows: [{ dayOfWeek: 3, start: "09:30", end: "11:00" }],
      }).band,
      resolveTemporalBand({
        now: WED_1000,
        schedule: NINE_TO_FIVE,
        timezone: "UTC",
        dueAt: new Date("2026-08-19T12:00:00Z"),
      }).band,
      resolveTemporalBand({
        now: WED_1000,
        schedule: NINE_TO_FIVE,
        timezone: "UTC",
        dueAt: WED_1000,
      }).band,
    ]);
    expect([...reached].sort()).toEqual([...TEMPORAL_BANDS].sort());
  });

  describe("damping exemptions", () => {
    it.each(DAMPING_EXEMPT_ACTIVITY_FAMILIES)(
      "never damps %s even when the business is closed",
      (family) => {
        const result = resolveTemporalBand({
          now: WED_2200,
          schedule: NINE_TO_FIVE,
          timezone: "UTC",
          activityFamily: family,
        });
        expect(result.band).not.toBe("out-of-hours");
        expect(result.dampingExempt).toBe(true);
        expect(result.reasonCode).toBe("damping_exempt");
      },
    );

    it("still damps a non-exempt family at the same instant", () => {
      const result = resolveTemporalBand({
        now: WED_2200,
        schedule: NINE_TO_FIVE,
        timezone: "UTC",
        activityFamily: "todo-follow-up",
      });
      expect(result.band).toBe("out-of-hours");
      expect(result.dampingExempt).toBe(false);
    });

    it("classifies exemption membership", () => {
      expect(isDampingExempt("security-incident")).toBe(true);
      expect(isDampingExempt("interactive-chat")).toBe(false);
      expect(isDampingExempt(null)).toBe(false);
    });
  });

  describe("timezone handling", () => {
    it("reads the schedule in the org's zone, not the host zone", () => {
      // 2026-08-19T22:00Z is 18:00 in New York (EDT) — inside 09:00–17:00? No,
      // 18:00 is past close, so closed. At 2026-08-19T20:00Z it is 16:00 EDT: open.
      expect(
        resolveTemporalBand({
          now: new Date("2026-08-19T20:00:00Z"),
          schedule: NINE_TO_FIVE,
          timezone: "America/New_York",
        }).band,
      ).toBe("in-hours");
      expect(
        resolveTemporalBand({
          now: new Date("2026-08-19T20:00:00Z"),
          schedule: NINE_TO_FIVE,
          timezone: "UTC",
        }).band,
      ).toBe("out-of-hours");
    });

    it("honours the same wall-clock rule either side of a DST transition", () => {
      // US DST ends 2026-11-01. 14:00 local on either side must read as in-hours
      // even though the UTC offset differs.
      const beforeDst = new Date("2026-10-30T18:00:00Z"); // 14:00 EDT (UTC-4)
      const afterDst = new Date("2026-11-02T19:00:00Z"); // 14:00 EST (UTC-5)
      expect(
        resolveTemporalBand({
          now: beforeDst,
          schedule: NINE_TO_FIVE,
          timezone: "America/New_York",
        }).band,
      ).toBe("in-hours");
      expect(
        resolveTemporalBand({
          now: afterDst,
          schedule: NINE_TO_FIVE,
          timezone: "America/New_York",
        }).band,
      ).toBe("in-hours");
    });

    it("falls back rather than throwing on an unknown zone", () => {
      expect(() =>
        resolveTemporalBand({
          now: WED_1000,
          schedule: NINE_TO_FIVE,
          timezone: "Not/AZone",
        }),
      ).not.toThrow();
    });
  });

  describe("fail-open", () => {
    it("resolves in-hours when no schedule is configured", () => {
      const result = resolveTemporalBand({ now: WED_2200, schedule: null });
      expect(result.band).toBe("in-hours");
      expect(result.reasonCode).toBe("no_schedule");
    });

    it("ignores a malformed day rather than throwing", () => {
      const broken = {
        ...NINE_TO_FIVE,
        wednesday: { enabled: true, open: "not-a-time", close: "17:00" },
      } as WeeklySchedule;
      expect(resolveTemporalBand({ now: WED_1000, schedule: broken, timezone: "UTC" }).band).toBe(
        "out-of-hours",
      );
    });

    it("ignores an invalid dueAt", () => {
      expect(
        resolveTemporalBand({
          now: WED_1000,
          schedule: NINE_TO_FIVE,
          timezone: "UTC",
          dueAt: new Date("nonsense"),
        }).band,
      ).toBe("in-hours");
    });
  });

  it("is deterministic for a fixed instant", () => {
    const args = { now: WED_1000, schedule: NINE_TO_FIVE, timezone: "UTC" };
    expect(resolveTemporalBand(args)).toEqual(resolveTemporalBand(args));
  });
});
