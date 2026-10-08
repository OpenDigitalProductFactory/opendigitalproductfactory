import { describe, expect, it } from "vitest";
import { admittedSpeedCounters, freezeSpeedCounters, speedCounterRegressions } from "./speed-counter-ratchet";
import type { SpeedCounterName } from "./speed-counters";

const NOW = { scriptBytes: 250_000, requestCount: 40, layoutShifts: 2, longTasks: 1 };
const ADMITTED = new Set<SpeedCounterName>(["scriptBytes"]);

describe("speed-counter ratchet (BI-BDB43823 AC-4)", () => {
  it("fails an admitted counter above its ceiling", () => {
    expect(speedCounterRegressions(NOW, { scriptBytes: 200_000 }, ADMITTED)).toEqual([
      "scriptBytes (speed counter): 200000 → 250000",
    ]);
  });

  it("never fails a counter that is not admitted, however far it moves", () => {
    expect(speedCounterRegressions(NOW, { scriptBytes: 300_000, requestCount: 1, layoutShifts: 0 }, ADMITTED)).toEqual([]);
  });

  it("reports nothing for a route with no frozen counter value yet", () => {
    expect(speedCounterRegressions(NOW, {}, ADMITTED)).toEqual([]);
    expect(speedCounterRegressions(NOW, undefined, ADMITTED)).toEqual([]);
    expect(speedCounterRegressions(undefined, { scriptBytes: 1 }, ADMITTED)).toEqual([]);
  });

  it("reads admission from the committed file: an empty file admits nothing", () => {
    expect(admittedSpeedCounters({ counters: [] }).size).toBe(0);
    expect([...admittedSpeedCounters({ counters: [{ counter: "scriptBytes", status: "admitted" }, { counter: "longTasks", status: "rejected" }] })]).toEqual(["scriptBytes"]);
  });
});

describe("speed-counter freeze (BI-BDB43823 AC-5)", () => {
  it("lowers a ceiling when the count improves", () => {
    expect(freezeSpeedCounters({ ...NOW, scriptBytes: 180_000 }, { scriptBytes: 200_000 }, ADMITTED)).toEqual({ scriptBytes: 180_000 });
  });

  it("never raises a ceiling on refresh", () => {
    expect(freezeSpeedCounters(NOW, { scriptBytes: 200_000 }, ADMITTED)).toEqual({ scriptBytes: 200_000 });
  });

  it("records the current value when there is no previous ceiling", () => {
    expect(freezeSpeedCounters(NOW, undefined, ADMITTED)).toEqual({ scriptBytes: 250_000 });
  });

  it("freezes nothing while no counter is admitted", () => {
    expect(freezeSpeedCounters(NOW, undefined, new Set())).toBeUndefined();
  });
});
