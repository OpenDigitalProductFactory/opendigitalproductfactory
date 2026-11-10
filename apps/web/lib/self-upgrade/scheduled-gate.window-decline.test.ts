import { beforeEach, describe, expect, it, vi } from "vitest";

// BI-EF1AC111 (AC-3): a window that passes without a check keeps its reason,
// and the daytime "outside-window" ticks that follow do not erase it.

const store = vi.hoisted(() => new Map<string, unknown>());
const mocks = vi.hoisted(() => ({ getLastCheckedAt: vi.fn() }));

vi.mock("@dpf/db", () => ({
  prisma: {
    platformConfig: {
      upsert: vi.fn(async ({ where, update }: { where: { key: string }; update: { value: unknown } }) => {
        store.set(where.key, update.value);
      }),
      findUnique: vi.fn(async ({ where }: { where: { key: string } }) =>
        store.has(where.key) ? { value: store.get(where.key) } : null),
    },
  },
}));
vi.mock("@/lib/operating-hours-read", () => ({
  resolveOperatingScheduleForSystem: vi.fn(async () => ({
    schedule: {},
    timezone: "UTC",
    timezoneKnown: true,
    lowTrafficWindows: [],
  })),
}));
vi.mock("@/lib/self-upgrade/last-check", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./last-check")>()),
  getLastCheckedAt: mocks.getLastCheckedAt,
}));

import {
  getScheduledDecline,
  getWindowDecline,
  missedWindowDecline,
  recordScheduledDecline,
} from "./scheduled-gate";

const CONFIG = {
  maintenanceWindows: [{ dayOfWeek: [0, 1, 2, 3, 4, 5, 6], startTime: "23:00", endTime: "05:00" }],
};
const LAST_CHECKED = new Date("2026-11-03T23:02:00.000Z");

beforeEach(() => {
  store.clear();
  mocks.getLastCheckedAt.mockResolvedValue(LAST_CHECKED);
});

describe("window decline record", () => {
  it("keeps the in-window reason after later outside-window ticks", async () => {
    await recordScheduledDecline("cooldown: 2026-11-05T01:00:00.000Z", new Date("2026-11-04T23:00:00.000Z"), CONFIG);
    await recordScheduledDecline("outside-window", new Date("2026-11-05T13:00:00.000Z"), CONFIG);

    expect(await getScheduledDecline()).toMatchObject({ reason: "outside-window" });
    const windowDecline = await getWindowDecline();
    expect(windowDecline).toEqual({
      reason: "cooldown: 2026-11-05T01:00:00.000Z",
      at: "2026-11-04T23:00:00.000Z",
      windowOpenedAt: "2026-11-04T23:00:00.000Z",
    });
    expect(missedWindowDecline(windowDecline, LAST_CHECKED)).toEqual(windowDecline);
  });

  it("stops reporting the miss once a check has run", async () => {
    await recordScheduledDecline("active-run: SUR-1", new Date("2026-11-04T23:00:00.000Z"), CONFIG);
    const windowDecline = await getWindowDecline();
    expect(missedWindowDecline(windowDecline, new Date("2026-11-05T00:00:00.000Z"))).toBeNull();
  });

  it("does not count the interval throttle after this opening's check as a miss", async () => {
    mocks.getLastCheckedAt.mockResolvedValue(new Date("2026-11-04T23:00:00.000Z"));
    await recordScheduledDecline("interval-not-elapsed", new Date("2026-11-05T00:00:00.000Z"), CONFIG);
    expect(await getWindowDecline()).toBeNull();
  });

  it("does not record a window decline without the config or for a self-explaining reason", async () => {
    await recordScheduledDecline("cooldown", new Date("2026-11-04T23:00:00.000Z"));
    await recordScheduledDecline("blackout-period: freeze until x", new Date("2026-11-04T23:00:00.000Z"), CONFIG);
    expect(await getWindowDecline()).toBeNull();
  });
});
