import { describe, expect, it } from "vitest";

import {
  readScheduledWorkTrigger,
  SCHEDULED_WORK_TRIGGER_KINDS,
  temporalInputForTrigger,
  withScheduledWorkTrigger,
} from "./scheduled-work-trigger";
import { resolveTemporalBand } from "@/lib/work-posture";
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

describe("readScheduledWorkTrigger", () => {
  it("reads every declared trigger kind", () => {
    for (const kind of SCHEDULED_WORK_TRIGGER_KINDS) {
      expect(readScheduledWorkTrigger({ trigger: { kind } })?.kind).toBe(kind);
    }
  });

  it("returns null when nothing was recorded", () => {
    expect(readScheduledWorkTrigger(null)).toBeNull();
    expect(readScheduledWorkTrigger({})).toBeNull();
    expect(readScheduledWorkTrigger({ trigger: {} })).toBeNull();
    expect(readScheduledWorkTrigger("nonsense")).toBeNull();
    expect(readScheduledWorkTrigger([{ kind: "time" }])).toBeNull();
  });

  it("rejects an unknown trigger kind rather than accepting it", () => {
    expect(readScheduledWorkTrigger({ trigger: { kind: "cosmic-ray" } })).toBeNull();
  });

  it("drops an obligation with no usable due date", () => {
    // An obligation nothing can measure is not an obligation; recording it as
    // one would make the job look deadline-bound when it is not.
    expect(
      readScheduledWorkTrigger({ trigger: { kind: "time", obligation: { dueAt: "soon" } } })
        ?.obligation,
    ).toBeNull();
    expect(
      readScheduledWorkTrigger({ trigger: { kind: "time", obligation: {} } })?.obligation,
    ).toBeNull();
  });

  it("keeps a usable obligation with its label", () => {
    const trigger = readScheduledWorkTrigger({
      trigger: {
        kind: "detected-need",
        workroomId: "room-1",
        obligation: { dueAt: "2026-08-20T09:00:00.000Z", label: "Q3 filing" },
      },
    });
    expect(trigger?.obligation?.dueAt).toBe("2026-08-20T09:00:00.000Z");
    expect(trigger?.obligation?.label).toBe("Q3 filing");
    expect(trigger?.workroomId).toBe("room-1");
  });
});

describe("withScheduledWorkTrigger", () => {
  const now = new Date("2026-08-23T00:00:00.000Z");

  it("preserves every existing taskConfig key", () => {
    const next = withScheduledWorkTrigger(
      { version: 2, watch: { productId: "P-1" } },
      { kind: "time" },
      now,
    );
    expect(next.version).toBe(2);
    expect(next.watch).toEqual({ productId: "P-1" });
  });

  it("round-trips through the reader", () => {
    const config = withScheduledWorkTrigger(
      {},
      { kind: "detected-need", obligation: { dueAt: "2026-08-20T09:00:00.000Z" } },
      now,
    );
    const read = readScheduledWorkTrigger(config);
    expect(read?.kind).toBe("detected-need");
    expect(read?.obligation?.dueAt).toBe("2026-08-20T09:00:00.000Z");
  });

  it("replaces rather than nests a previous trigger", () => {
    const first = withScheduledWorkTrigger({}, { kind: "time" }, now);
    const second = withScheduledWorkTrigger(first, { kind: "user-request" }, now);
    expect(readScheduledWorkTrigger(second)?.kind).toBe("user-request");
  });
});

describe("temporalInputForTrigger — the case the BI exists for", () => {
  // "A job that fires at 03:00 to discharge an obligation due at 09:00 resolves
  // pre-deadline, not out-of-hours. Today it resolves neither, because the
  // resolver is never asked."
  const FIRES_AT_0300 = new Date("2026-08-19T03:00:00.000Z");
  const base = { now: FIRES_AT_0300, schedule: NINE_TO_FIVE, timezone: "UTC" } as const;

  it("without a trigger, an overnight tick is just out-of-hours", () => {
    expect(resolveTemporalBand(base).band).toBe("out-of-hours");
  });

  it("with the obligation recorded, the same tick is pre-deadline", () => {
    const trigger = readScheduledWorkTrigger({
      trigger: { kind: "time", obligation: { dueAt: "2026-08-19T09:00:00.000Z" } },
    });
    const input = temporalInputForTrigger(trigger, base);
    expect(resolveTemporalBand(input).band).toBe("pre-deadline");
  });

  it("a breached obligation reads as breach-imminent, not out-of-hours", () => {
    const trigger = readScheduledWorkTrigger({
      trigger: { kind: "time", obligation: { dueAt: "2026-08-19T02:00:00.000Z" } },
    });
    expect(resolveTemporalBand(temporalInputForTrigger(trigger, base)).band).toBe(
      "breach-imminent",
    );
  });

  it("passes the base through untouched when no obligation is recorded", () => {
    const trigger = readScheduledWorkTrigger({ trigger: { kind: "user-request" } });
    expect(temporalInputForTrigger(trigger, base)).toBe(base);
    expect(temporalInputForTrigger(null, base)).toBe(base);
  });
});
