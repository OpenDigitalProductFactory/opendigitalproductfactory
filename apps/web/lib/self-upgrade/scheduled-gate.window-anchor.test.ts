import { beforeEach, describe, expect, it, vi } from "vitest";

// BI-EF1AC111: the scheduled gate against a real nightly window (23:00-05:00
// UTC, every day), replaying the operator install's production timeline. Only the DB readers
// are stubbed; the window resolution and interval rule are the real ones.

const mocks = vi.hoisted(() => ({
  getActiveSelfUpgradeBlackout: vi.fn(),
  getLastCheckedAt: vi.fn(),
  getDeferredUpgradeRequest: vi.fn(),
}));

vi.mock("@dpf/db", () => ({ prisma: {} }));
vi.mock("@/lib/operating-hours-read", () => ({
  resolveOperatingScheduleForSystem: vi.fn(async () => ({
    schedule: {},
    timezone: "UTC",
    timezoneKnown: true,
    lowTrafficWindows: [],
  })),
}));
vi.mock("@/lib/self-upgrade/blackout", () => ({
  getActiveSelfUpgradeBlackout: mocks.getActiveSelfUpgradeBlackout,
}));
vi.mock("@/lib/self-upgrade/last-check", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./last-check")>()),
  getLastCheckedAt: mocks.getLastCheckedAt,
}));
vi.mock("@/lib/self-upgrade/deferred-request", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./deferred-request")>()),
  getDeferredUpgradeRequest: mocks.getDeferredUpgradeRequest,
}));

import { evaluateScheduledGate } from "./scheduled-gate";

const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];
const CONFIG = {
  maintenanceWindows: [{ dayOfWeek: EVERY_DAY, startTime: "23:00", endTime: "05:00" }],
  checkIntervalHours: 24,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getActiveSelfUpgradeBlackout.mockResolvedValue(null);
  mocks.getDeferredUpgradeRequest.mockResolvedValue(null);
});

describe("evaluateScheduledGate — interval anchored to the window opening (BI-EF1AC111)", () => {
  it("AC-1: runs at the 23:00 tick after a 13:48 manual upgrade the same day", async () => {
    mocks.getLastCheckedAt.mockResolvedValue(new Date("2026-11-04T13:48:00.000Z"));
    const decline = await evaluateScheduledGate({ config: CONFIG, now: new Date("2026-11-04T23:00:00.000Z") });
    expect(decline).toBeNull();
  });

  it("AC-2: runs at the 23:00 tick after the previous night's 23:02 run", async () => {
    mocks.getLastCheckedAt.mockResolvedValue(new Date("2026-11-03T23:02:00.000Z"));
    const decline = await evaluateScheduledGate({ config: CONFIG, now: new Date("2026-11-04T23:00:00.000Z") });
    expect(decline).toBeNull();
  });

  it("still checks only once per opening: the 00:00 tick after a 23:00 run declines", async () => {
    mocks.getLastCheckedAt.mockResolvedValue(new Date("2026-11-04T23:00:00.000Z"));
    const decline = await evaluateScheduledGate({ config: CONFIG, now: new Date("2026-11-05T00:00:00.000Z") });
    expect(decline).toEqual({ reason: "interval-not-elapsed" });
  });

  it("stays outside the window during the day", async () => {
    mocks.getLastCheckedAt.mockResolvedValue(new Date("2026-11-04T13:48:00.000Z"));
    const decline = await evaluateScheduledGate({ config: CONFIG, now: new Date("2026-11-04T15:00:00.000Z") });
    expect(decline).toEqual({ reason: "outside-window" });
  });
});
