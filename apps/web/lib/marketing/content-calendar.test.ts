import { describe, expect, it } from "vitest";
import {
  buildContentCalendar,
  weekStartUtc,
  type CalendarTaskInput,
} from "./content-calendar";

const CREATED = new Date("2026-01-01T00:00:00.000Z");

function task(overrides: Partial<CalendarTaskInput> & { taskId: string }): CalendarTaskInput {
  return {
    title: `Task ${overrides.taskId}`,
    channel: "linkedin",
    assetType: "post",
    status: "draft",
    campaignId: "camp_1",
    dueWindow: null,
    createdAt: CREATED,
    ...overrides,
  };
}

describe("weekStartUtc", () => {
  it("returns the Monday 00:00 UTC of the containing week", () => {
    // 2026-07-15 is a Wednesday → Monday is 2026-07-13.
    const monday = weekStartUtc(new Date("2026-07-15T09:30:00.000Z"));
    expect(monday.getUTCDay()).toBe(1); // Monday
    expect(monday.toISOString().slice(0, 10)).toBe("2026-07-13");
  });

  it("maps a Sunday to the PRECEDING Monday (Mon–Sun weeks)", () => {
    // 2026-07-19 is a Sunday → still the week starting Mon 2026-07-13.
    const monday = weekStartUtc(new Date("2026-07-19T23:59:00.000Z"));
    expect(monday.toISOString().slice(0, 10)).toBe("2026-07-13");
  });

  it("keeps a Monday as its own week start", () => {
    const monday = weekStartUtc(new Date("2026-07-20T00:00:00.000Z"));
    expect(monday.toISOString().slice(0, 10)).toBe("2026-07-20");
  });
});

describe("buildContentCalendar", () => {
  it("buckets ISO-dated tasks into weeks and sorts weeks ascending", () => {
    const cal = buildContentCalendar([
      task({ taskId: "b", dueWindow: "2026-07-20" }), // later week
      task({ taskId: "a", dueWindow: "2026-07-15" }), // earlier week
    ]);
    expect(cal.weeks.map((w) => w.weekStart)).toEqual(["2026-07-13", "2026-07-20"]);
    expect(cal.weeks[0]!.entries[0]!.taskId).toBe("a");
    expect(cal.weeks[1]!.entries[0]!.taskId).toBe("b");
    expect(cal.totalTasks).toBe(2);
    expect(cal.unscheduled).toHaveLength(0);
  });

  it("groups multiple tasks due in the same Mon–Sun week into one bucket", () => {
    const cal = buildContentCalendar([
      task({ taskId: "wed", dueWindow: "2026-07-15" }),
      task({ taskId: "sun", dueWindow: "2026-07-19" }),
    ]);
    expect(cal.weeks).toHaveLength(1);
    expect(cal.weeks[0]!.weekStart).toBe("2026-07-13");
    expect(cal.weeks[0]!.entries.map((e) => e.taskId)).toEqual(["wed", "sun"]);
  });

  it("sorts entries within a week by due date then title", () => {
    const cal = buildContentCalendar([
      task({ taskId: "later", title: "Zeta", dueWindow: "2026-07-17" }),
      task({ taskId: "earlier", title: "Alpha", dueWindow: "2026-07-14" }),
    ]);
    expect(cal.weeks[0]!.entries.map((e) => e.title)).toEqual(["Alpha", "Zeta"]);
  });

  it("routes unparseable and null due windows to unscheduled (never dropped)", () => {
    const cal = buildContentCalendar([
      task({ taskId: "scheduled", dueWindow: "2026-07-15" }),
      task({ taskId: "vague", dueWindow: "sometime soon" }),
      task({ taskId: "none", dueWindow: null }),
    ]);
    expect(cal.weeks).toHaveLength(1);
    expect(cal.unscheduled.map((e) => e.taskId).sort()).toEqual(["none", "vague"]);
    expect(cal.unscheduled.every((e) => e.dueDate === null)).toBe(true);
    expect(cal.totalTasks).toBe(3);
  });

  it("resolves relative 'week N' windows against createdAt", () => {
    // createdAt = 2026-01-01; "week 2" → +7 days = 2026-01-08 (a Thursday) →
    // week start Monday 2026-01-05.
    const cal = buildContentCalendar([task({ taskId: "w2", dueWindow: "week 2" })]);
    expect(cal.unscheduled).toHaveLength(0);
    expect(cal.weeks[0]!.entries[0]!.dueDate).toBe("2026-01-08");
    expect(cal.weeks[0]!.weekStart).toBe("2026-01-05");
  });

  it("counts every task by channel and status, reconciling with totalTasks", () => {
    const cal = buildContentCalendar([
      task({ taskId: "1", channel: "linkedin", status: "draft", dueWindow: "2026-07-15" }),
      task({ taskId: "2", channel: "email", status: "approved", dueWindow: "2026-07-16" }),
      task({ taskId: "3", channel: null, status: "draft", dueWindow: null }),
    ]);
    expect(cal.byChannel).toEqual({ linkedin: 1, email: 1, unassigned: 1 });
    expect(cal.byStatus).toEqual({ draft: 2, approved: 1 });
    const channelTotal = Object.values(cal.byChannel).reduce((a, b) => a + b, 0);
    expect(channelTotal).toBe(cal.totalTasks);
  });

  it("routes an overflowing 'week N' due window to unscheduled without throwing", () => {
    // Regression: parseDueWindowToDate used to return an Invalid Date here, which
    // is truthy and crashed the whole calendar via isoDate/toISOString.
    expect(() =>
      buildContentCalendar([
        task({ taskId: "ok", dueWindow: "2026-07-15" }),
        task({ taskId: "overflow", dueWindow: "week 999999999999" }),
      ]),
    ).not.toThrow();
    const cal = buildContentCalendar([
      task({ taskId: "ok", dueWindow: "2026-07-15" }),
      task({ taskId: "overflow", dueWindow: "week 999999999999" }),
    ]);
    expect(cal.weeks).toHaveLength(1);
    expect(cal.unscheduled.map((e) => e.taskId)).toEqual(["overflow"]);
    expect(cal.totalTasks).toBe(2);
  });

  it("returns an empty calendar for no tasks", () => {
    const cal = buildContentCalendar([]);
    expect(cal).toEqual({
      weeks: [],
      unscheduled: [],
      byChannel: {},
      byStatus: {},
      totalTasks: 0,
    });
  });
});
