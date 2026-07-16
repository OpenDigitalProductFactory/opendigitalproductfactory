import { describe, expect, it } from "vitest";
import { evaluateDrain, nextWeeklyReset, type DrainPolicyInput } from "./drain-policy";

function base(overrides: Partial<DrainPolicyInput> = {}): DrainPolicyInput {
  return {
    enabled: true,
    now: new Date("2026-07-12T12:00:00Z"),
    windowResetAt: new Date("2026-07-12T18:00:00Z"), // 6h out
    drainWindowHours: 12,
    poolExhausted: false,
    activeBuilds: 1,
    wipCap: 4,
    maxDispatch: 3,
    ...overrides,
  };
}

describe("nextWeeklyReset", () => {
  it("returns the next Monday 00:00 UTC after now", () => {
    // 2026-07-12 is a Sunday. Next Monday 00:00 = 2026-07-13T00:00Z.
    const r = nextWeeklyReset(new Date("2026-07-12T12:00:00Z"), 1, 0);
    expect(r.toISOString()).toBe("2026-07-13T00:00:00.000Z");
  });

  it("jumps a full week when the boundary is exactly now", () => {
    const now = new Date("2026-07-13T00:00:00Z"); // a Monday 00:00
    const r = nextWeeklyReset(now, 1, 0);
    expect(r.toISOString()).toBe("2026-07-20T00:00:00.000Z");
  });

  it("handles same-day-later-hour today", () => {
    // Sunday 12:00, reset Sunday (0) 18:00 -> later today.
    const r = nextWeeklyReset(new Date("2026-07-12T12:00:00Z"), 0, 18);
    expect(r.toISOString()).toBe("2026-07-12T18:00:00.000Z");
  });
});

describe("evaluateDrain", () => {
  it("drains when near reset, pool healthy, slots free", () => {
    const d = evaluateDrain(base());
    expect(d.drain).toBe(true);
    expect(d.targetDispatch).toBe(3); // min(headroom 3, maxDispatch 3)
    expect(d.hoursUntilReset).toBe(6);
  });

  it("caps dispatch at WIP headroom", () => {
    const d = evaluateDrain(base({ activeBuilds: 3, wipCap: 4, maxDispatch: 3 }));
    expect(d.drain).toBe(true);
    expect(d.targetDispatch).toBe(1); // headroom 1 < maxDispatch 3
  });

  it("does not drain when disabled", () => {
    expect(evaluateDrain(base({ enabled: false })).drain).toBe(false);
  });

  it("does not drain into an exhausted pool", () => {
    const d = evaluateDrain(base({ poolExhausted: true }));
    expect(d.drain).toBe(false);
    expect(d.reason).toMatch(/exhausted/);
  });

  it("does not drain outside the window", () => {
    const d = evaluateDrain(base({ windowResetAt: new Date("2026-07-14T12:00:00Z") })); // 48h out
    expect(d.drain).toBe(false);
    expect(d.reason).toMatch(/not in drain window/);
  });

  it("does not drain when WIP cap reached", () => {
    const d = evaluateDrain(base({ activeBuilds: 4, wipCap: 4 }));
    expect(d.drain).toBe(false);
    expect(d.reason).toMatch(/WIP cap reached/);
  });
});
