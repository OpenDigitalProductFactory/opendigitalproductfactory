import { afterEach, describe, expect, it, vi } from "vitest";

// Tests for the clock-shift setup used by the time-bomb detector (BI-6A4F47B9).
//
// The setup file installs itself at import time from an env var, so these
// exercise it by re-importing under a controlled environment rather than by
// calling a function. `vi.resetModules()` is what makes each case a fresh
// install.

const ORIGINAL_DATE = Date;

async function loadSetupWith(shift: string | undefined) {
  globalThis.Date = ORIGINAL_DATE;
  if (shift === undefined) delete process.env.DPF_CLOCK_SHIFT_DAYS;
  else process.env.DPF_CLOCK_SHIFT_DAYS = shift;
  vi.resetModules();
  await import("../../vitest.clock-shift-setup");
}

afterEach(() => {
  globalThis.Date = ORIGINAL_DATE;
  delete process.env.DPF_CLOCK_SHIFT_DAYS;
  vi.resetModules();
});

describe("clock-shift setup: inert unless explicitly enabled", () => {
  // This is the load-bearing property. The setup file runs for EVERY test in the
  // repo, so if it shifted time by accident it would not detect bombs — it would
  // become one.
  it("does not touch Date when the env var is unset", async () => {
    await loadSetupWith(undefined);
    expect(globalThis.Date).toBe(ORIGINAL_DATE);
  });

  it("does not touch Date for zero, empty, or non-numeric values", async () => {
    for (const value of ["0", "", "   ", "soon", "NaN"]) {
      await loadSetupWith(value);
      expect(globalThis.Date, `value: ${JSON.stringify(value)}`).toBe(ORIGINAL_DATE);
    }
  });
});

describe("clock-shift setup: shifts 'now' only", () => {
  it("moves Date.now() and bare new Date() forward by the requested days", async () => {
    const before = ORIGINAL_DATE.now();
    await loadSetupWith("90");
    const shiftedNow = Date.now();
    const after = ORIGINAL_DATE.now();

    const ninetyDays = 90 * 24 * 60 * 60 * 1000;
    // Bounded by the real clock either side, so this cannot pass by coincidence.
    expect(shiftedNow).toBeGreaterThanOrEqual(before + ninetyDays);
    expect(shiftedNow).toBeLessThanOrEqual(after + ninetyDays);
    expect(new Date().getTime()).toBeGreaterThanOrEqual(before + ninetyDays);
  });

  it("accepts a negative shift, for checking whether something already detonated", async () => {
    const before = ORIGINAL_DATE.now();
    await loadSetupWith("-30");
    expect(Date.now()).toBeLessThan(before);
  });

  it("leaves an explicitly-constructed date untouched", async () => {
    // The fixture under test is exactly what must NOT move: shifting it too
    // would keep the comparison in the same relative position and hide the bomb.
    await loadSetupWith("90");
    expect(new Date("2030-01-01T00:00:00.000Z").toISOString()).toBe("2030-01-01T00:00:00.000Z");
    expect(new Date(0).getTime()).toBe(0);
  });

  it("keeps Date's static and instance surface working", async () => {
    await loadSetupWith("90");
    expect(Date.UTC(2030, 0, 1)).toBe(ORIGINAL_DATE.UTC(2030, 0, 1));
    expect(Date.parse("2030-01-01T00:00:00.000Z")).toBe(
      ORIGINAL_DATE.parse("2030-01-01T00:00:00.000Z"),
    );
    expect(new Date("2030-06-15T12:00:00.000Z") instanceof Date).toBe(true);
    expect(new Date("2030-06-15T12:00:00.000Z").getUTCFullYear()).toBe(2030);
  });
});

describe("clock-shift setup: this is what a bomb looks like", () => {
  // Demonstrates the detector's premise end to end: the same assertion passes
  // unshifted and fails shifted, which is the signal the runner diffs on.
  const expiresAt = new Date(ORIGINAL_DATE.now() + 60 * 60 * 1000); // one hour out
  const guard = () => {
    if (expiresAt.getTime() <= Date.now()) throw new Error("expiry must be in the future");
  };

  it("passes against the current clock", async () => {
    await loadSetupWith(undefined);
    expect(guard).not.toThrow();
  });

  it("fails against a shifted clock — exactly the care-intake failure mode", async () => {
    await loadSetupWith("90");
    expect(guard).toThrow("expiry must be in the future");
  });
});
