import { describe, expect, it } from "vitest";
import { classifyStandingRhythm, cycleDateOf, RHYTHM_WINDOW_DAYS, type DriveRunRow } from "./standing-run-history";

const now = new Date("2026-11-10T15:00:00.000Z");
const key = (date: string) => `payables-watch@1.1.0:${date}`;
const tick = (date: string, at: string, action = "dispatch_agent", reason = "agent_stage"): DriveRunRow =>
  ({ runKey: key(date), action, reason, recordedAt: at });
const done = (date: string, at: string): DriveRunRow => tick(date, at, "stop", "success");

describe("cycleDateOf", () => {
  it("reads the cycle date a run key ends with", () => {
    expect(cycleDateOf(key("2026-11-03"))).toBe("2026-11-03");
    expect(cycleDateOf("no-date")).toBeNull();
  });
});

describe("classifyStandingRhythm", () => {
  it("returns one slot per day of the window, oldest first, ending today", () => {
    const rhythm = classifyStandingRhythm({ rows: [], currentRunKey: key("2026-10-01"), now });
    expect(rhythm.slots).toHaveLength(RHYTHM_WINDOW_DAYS);
    expect(rhythm.slots[0]?.date).toBe("2026-10-28");
    expect(rhythm.slots.at(-1)?.date).toBe("2026-11-10");
  });

  it("classes a run concluded within its own cycle as on time, and a later conclusion as late", () => {
    const rhythm = classifyStandingRhythm({
      rows: [tick("2026-11-08", "2026-11-08T00:15:00Z"), done("2026-11-08", "2026-11-08T09:00:00Z"),
        tick("2026-11-09", "2026-11-09T00:15:00Z"), done("2026-11-09", "2026-11-10T02:00:00Z")],
      currentRunKey: key("2026-11-09"), now,
    });
    const byDate = Object.fromEntries(rhythm.slots.map((slot) => [slot.date, slot.state]));
    expect(byDate["2026-11-08"]).toBe("on-time");
    expect(byDate["2026-11-09"]).toBe("late");
  });

  it("counts a cycle with no run of its own as missed once the room's history has begun", () => {
    const rhythm = classifyStandingRhythm({
      rows: [done("2026-11-05", "2026-11-05T10:00:00Z"), done("2026-11-08", "2026-11-08T10:00:00Z")],
      currentRunKey: key("2026-11-08"), now,
    });
    const byDate = Object.fromEntries(rhythm.slots.map((slot) => [slot.date, slot.state]));
    expect(byDate["2026-11-06"]).toBe("missed");
    expect(byDate["2026-11-07"]).toBe("missed");
    expect(byDate["2026-11-09"]).toBe("missed");
  });

  it("shows a run stuck since before the window as missed cycles and running today", () => {
    const rhythm = classifyStandingRhythm({ rows: [tick("2026-10-07", "2026-10-07T01:00:00Z")], currentRunKey: key("2026-10-07"), now });
    expect(rhythm.slots.slice(0, -1).every((slot) => slot.state === "missed")).toBe(true);
    expect(rhythm.slots.at(-1)?.state).toBe("running");
    expect(rhythm.runningSince).toBe("2026-10-07");
  });

  it("marks a run started today and still open as running, not late", () => {
    const rhythm = classifyStandingRhythm({ rows: [done("2026-11-09", "2026-11-09T05:00:00Z"), tick("2026-11-10", "2026-11-10T00:15:00Z")],
      currentRunKey: key("2026-11-10"), now });
    expect(rhythm.slots.at(-1)?.state).toBe("running");
  });

  it("marks today as due when the last run concluded and today's has not started", () => {
    const rhythm = classifyStandingRhythm({ rows: [done("2026-11-09", "2026-11-09T05:00:00Z")], currentRunKey: key("2026-11-09"), now });
    expect(rhythm.slots.at(-1)?.state).toBe("due");
    expect(rhythm.runningSince).toBeNull();
  });

  it("infers nothing before the first recorded run", () => {
    const rhythm = classifyStandingRhythm({ rows: [done("2026-11-08", "2026-11-08T05:00:00Z")], currentRunKey: key("2026-11-08"), now });
    const byDate = Object.fromEntries(rhythm.slots.map((slot) => [slot.date, slot.state]));
    expect(byDate["2026-11-07"]).toBe("no-record");
    expect(byDate["2026-10-28"]).toBe("no-record");
    expect(rhythm.counts).toEqual({ "on-time": 1, late: 0, missed: 1 });
  });

  it("treats sleeping on a completed cycle as a conclusion, and keeps the earliest one", () => {
    const rhythm = classifyStandingRhythm({
      rows: [tick("2026-11-09", "2026-11-09T23:59:00Z", "do_not_wake", "cycle_complete"), done("2026-11-09", "2026-11-10T03:00:00Z")],
      currentRunKey: key("2026-11-09"), now,
    });
    expect(rhythm.slots.find((slot) => slot.date === "2026-11-09")?.state).toBe("on-time");
  });

  it("dates history from an earlier recorded run the window does not show", () => {
    const rhythm = classifyStandingRhythm({ rows: [done("2026-11-09", "2026-11-09T05:00:00Z")], currentRunKey: key("2026-11-09"),
      historyFrom: "2026-10-01", now });
    expect(rhythm.slots[0]?.state).toBe("missed");
  });
});
