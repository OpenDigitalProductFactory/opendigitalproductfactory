import { describe, expect, it } from "vitest";

import {
  isMeasurementRuntime,
  measurementClockPin,
  measurementNow,
  settleBootSync,
  settleBootSyncs,
} from "./measurement-runtime";

describe("isMeasurementRuntime", () => {
  it("is off by default — production and dev boots are unchanged", () => {
    expect(isMeasurementRuntime({})).toBe(false);
    expect(isMeasurementRuntime({ DPF_MEASUREMENT_RUNTIME: "" })).toBe(false);
    expect(isMeasurementRuntime({ DPF_MEASUREMENT_RUNTIME: "0" })).toBe(false);
  });

  it("recognizes the standard truthy env forms", () => {
    expect(isMeasurementRuntime({ DPF_MEASUREMENT_RUNTIME: "1" })).toBe(true);
    expect(isMeasurementRuntime({ DPF_MEASUREMENT_RUNTIME: "true" })).toBe(true);
    expect(isMeasurementRuntime({ DPF_MEASUREMENT_RUNTIME: "on" })).toBe(true);
  });
});

describe("settleBootSync", () => {
  it("awaits the task under measurement runtime so it completes before serving", async () => {
    let completed = false;
    await settleBootSync(true, async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      completed = true;
    });
    expect(completed).toBe(true);
  });

  it("fire-and-forgets outside measurement runtime (pre-existing boot behavior)", async () => {
    let started = false;
    let completed = false;
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await settleBootSync(false, async () => {
      started = true;
      await gate;
      completed = true;
    });
    // settleBootSync returned while the task is still pending — it must not
    // have blocked boot on the task.
    expect(started).toBe(true);
    expect(completed).toBe(false);
    release();
    await gate;
  });

  it("swallows a rejecting task under measurement runtime — boot syncs are non-fatal", async () => {
    await expect(
      settleBootSync(true, async () => {
        throw new Error("boot sync failed");
      }),
    ).resolves.toBeUndefined();
  });
});

describe("settleBootSyncs", () => {
  it("settles render-relevant reconcilers in order under measurement runtime", async () => {
    const events: string[] = [];

    await settleBootSyncs(true, [
      async () => {
        events.push("start:workforce");
        await Promise.resolve();
        events.push("end:workforce");
      },
      async () => {
        events.push("start:catalog");
        await Promise.resolve();
        events.push("end:catalog");
      },
      async () => {
        events.push("start:discovery");
        await Promise.resolve();
        events.push("end:discovery");
      },
    ]);

    expect(events).toEqual([
      "start:workforce",
      "end:workforce",
      "start:catalog",
      "end:catalog",
      "start:discovery",
      "end:discovery",
    ]);
  });

  it("starts every reconciler without blocking normal production boot", async () => {
    const started: string[] = [];
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    await settleBootSyncs(false, [
      async () => {
        started.push("workforce");
        await gate;
      },
      async () => {
        started.push("catalog");
        await gate;
      },
      async () => {
        started.push("discovery");
        await gate;
      },
    ]);

    expect(started).toEqual(["workforce", "catalog", "discovery"]);
    release();
    await gate;
  });
});

describe("measurementClockPin / measurementNow (BI-99909E53)", () => {
  const PIN = "2026-09-18T12:00:00.000Z";

  it("ignores the pin outside measurement runtime — a production portal can never be pinned", () => {
    expect(measurementClockPin({ DPF_MEASUREMENT_NOW: PIN })).toBeNull();
    expect(measurementClockPin({ DPF_MEASUREMENT_RUNTIME: "0", DPF_MEASUREMENT_NOW: PIN })).toBeNull();
    const before = Date.now();
    const now = measurementNow({ DPF_MEASUREMENT_NOW: PIN }).getTime();
    expect(now).toBeGreaterThanOrEqual(before);
  });

  it("returns the pinned instant under measurement runtime", () => {
    const env = { DPF_MEASUREMENT_RUNTIME: "1", DPF_MEASUREMENT_NOW: PIN };
    expect(measurementClockPin(env)?.toISOString()).toBe(PIN);
    expect(measurementNow(env).toISOString()).toBe(PIN);
  });

  it("falls back to the real clock when the pin is unset or unparsable", () => {
    expect(measurementClockPin({ DPF_MEASUREMENT_RUNTIME: "1" })).toBeNull();
    expect(measurementClockPin({ DPF_MEASUREMENT_RUNTIME: "1", DPF_MEASUREMENT_NOW: "  " })).toBeNull();
    expect(
      measurementClockPin({ DPF_MEASUREMENT_RUNTIME: "1", DPF_MEASUREMENT_NOW: "yesterday" }),
    ).toBeNull();
  });
});
