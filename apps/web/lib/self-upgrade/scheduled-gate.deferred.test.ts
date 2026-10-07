import { beforeEach, describe, expect, it, vi } from "vitest";

// BI-2128872C: a deferred agent request is honoured at the next window even
// when checkIntervalHours has not elapsed, so "queued for the next window" is
// true. Outside the window and during a blackout it still declines.

const mocks = vi.hoisted(() => ({
  resolveEffectiveUpgradeWindow: vi.fn(),
  getActiveSelfUpgradeBlackout: vi.fn(),
  getLastCheckedAt: vi.fn(),
  getDeferredUpgradeRequest: vi.fn(),
}));

vi.mock("@dpf/db", () => ({ prisma: {} }));
vi.mock("@/lib/self-upgrade/effective-window", () => ({
  resolveEffectiveUpgradeWindow: mocks.resolveEffectiveUpgradeWindow,
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

const NOW = new Date("2026-10-07T22:00:00.000Z");
const CONFIG = { maintenanceWindows: [], checkIntervalHours: 24 };
// Checked 6h ago: the 24h interval has NOT elapsed.
const LAST_CHECKED = new Date("2026-10-07T16:00:00.000Z");

beforeEach(() => {
  vi.clearAllMocks();
  mocks.resolveEffectiveUpgradeWindow.mockResolvedValue({ source: "operating-hours", open: true, nextWindowStart: null });
  mocks.getActiveSelfUpgradeBlackout.mockResolvedValue(null);
  mocks.getLastCheckedAt.mockResolvedValue(LAST_CHECKED);
  mocks.getDeferredUpgradeRequest.mockResolvedValue(null);
});

describe("evaluateScheduledGate — deferred agent request", () => {
  it("still throttles by interval when nothing was deferred", async () => {
    expect(await evaluateScheduledGate({ config: CONFIG, now: NOW })).toEqual({ reason: "interval-not-elapsed" });
  });

  it("proceeds in the window when a request was deferred after the last check", async () => {
    mocks.getDeferredUpgradeRequest.mockResolvedValue({
      requestedBy: "mcp:codex",
      requestedAt: "2026-10-07T17:00:00.000Z",
      runAt: "2026-10-07T22:00:00.000Z",
    });

    expect(await evaluateScheduledGate({ config: CONFIG, now: NOW })).toBeNull();
  });

  it("ignores a deferred request a later check already fulfilled", async () => {
    mocks.getDeferredUpgradeRequest.mockResolvedValue({
      requestedBy: "mcp:codex",
      requestedAt: "2026-10-07T15:00:00.000Z",
      runAt: "2026-10-07T22:00:00.000Z",
    });

    expect(await evaluateScheduledGate({ config: CONFIG, now: NOW })).toEqual({ reason: "interval-not-elapsed" });
  });

  it("never runs a deferred request outside the window", async () => {
    mocks.resolveEffectiveUpgradeWindow.mockResolvedValue({ source: "operating-hours", open: false, nextWindowStart: NOW });
    mocks.getDeferredUpgradeRequest.mockResolvedValue({
      requestedBy: "mcp:codex",
      requestedAt: "2026-10-07T17:00:00.000Z",
      runAt: null,
    });

    expect(await evaluateScheduledGate({ config: CONFIG, now: NOW })).toEqual({ reason: "outside-window" });
  });

  it("declines a 24/7 store without a timezone before reading the window", async () => {
    mocks.resolveEffectiveUpgradeWindow.mockResolvedValue({ source: "needs-timezone", open: true, nextWindowStart: null });

    expect(await evaluateScheduledGate({ config: CONFIG, now: NOW })).toEqual({ reason: "no-window-needs-timezone" });
  });
});
