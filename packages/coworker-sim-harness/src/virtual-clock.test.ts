import { describe, expect, it } from "vitest";

import { DAY, HOUR, MINUTE, VirtualClock } from "./virtual-clock";

describe("VirtualClock", () => {
  it("reports injected time, never wall-clock", () => {
    const clock = VirtualClock.fromIso("2026-06-14T09:00:00.000Z");
    expect(clock.nowIso()).toBe("2026-06-14T09:00:00.000Z");
    expect(clock.now()).toBe(Date.parse("2026-06-14T09:00:00.000Z"));
  });

  it("fires a scheduled event when time advances past its due instant", async () => {
    const clock = new VirtualClock(0);
    let fired = false;
    clock.scheduleIn(30 * MINUTE, () => {
      fired = true;
    });
    expect(await clock.advanceBy(10 * MINUTE)).toBe(0);
    expect(fired).toBe(false);
    expect(await clock.advanceBy(25 * MINUTE)).toBe(1);
    expect(fired).toBe(true);
    expect(clock.now()).toBe(35 * MINUTE);
  });

  it("fires events in due-time order, then insertion order for ties", async () => {
    const clock = new VirtualClock(0);
    const order: string[] = [];
    clock.scheduleAt(2 * HOUR, () => void order.push("b"));
    clock.scheduleAt(1 * HOUR, () => void order.push("a"));
    clock.scheduleAt(2 * HOUR, () => void order.push("c")); // same instant as b, scheduled later
    await clock.advanceBy(DAY);
    expect(order).toEqual(["a", "b", "c"]);
  });

  it("does not fire a cancelled event", async () => {
    const clock = new VirtualClock(0);
    let fired = false;
    const id = clock.scheduleIn(HOUR, () => {
      fired = true;
    });
    expect(clock.cancel(id)).toBe(true);
    expect(clock.pending()).toBe(0);
    await clock.advanceBy(DAY);
    expect(fired).toBe(false);
  });

  it("fires cascaded events scheduled by a firing event, if due before the target", async () => {
    const clock = new VirtualClock(0);
    const order: string[] = [];
    clock.scheduleIn(HOUR, () => {
      order.push("first");
      // a running-late cascade: firing this re-notifies downstream 10 min later
      clock.scheduleIn(10 * MINUTE, () => void order.push("cascade"));
    });
    const fired = await clock.advanceBy(2 * HOUR);
    expect(order).toEqual(["first", "cascade"]);
    expect(fired).toBe(2);
  });

  it("an event observes the correct now() at fire time", async () => {
    const clock = new VirtualClock(0);
    let observed = -1;
    clock.scheduleAt(90 * MINUTE, () => {
      observed = clock.now();
    });
    await clock.advanceBy(3 * HOUR);
    expect(observed).toBe(90 * MINUTE); // fired at its due instant, not at the target
  });

  it("refuses to move backward and rejects negative durations", async () => {
    const clock = new VirtualClock(1000);
    await expect(clock.advanceTo(500)).rejects.toThrow(/backward/);
    await expect(clock.advanceBy(-1)).rejects.toThrow(/non-negative/);
  });

  it("rejects unparseable ISO and non-finite instants", () => {
    expect(() => VirtualClock.fromIso("not-a-date")).toThrow();
    expect(() => new VirtualClock(Number.POSITIVE_INFINITY)).toThrow();
  });
});
