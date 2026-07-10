import { describe, expect, it } from "vitest";

import { isStale, newestSignal } from "./staleness";

const NOW = new Date("2026-07-09T12:00:00.000Z");

describe("isStale (EP-8DC217EB BET-10)", () => {
  it("is true when ts is older than the threshold", () => {
    const ts = new Date(NOW.getTime() - 61_000);
    expect(isStale(NOW, ts, 60_000)).toBe(true);
  });

  it("is false exactly at the threshold (strict >)", () => {
    const ts = new Date(NOW.getTime() - 60_000);
    expect(isStale(NOW, ts, 60_000)).toBe(false);
  });

  it("is false for a fresh signal", () => {
    const ts = new Date(NOW.getTime() - 5_000);
    expect(isStale(NOW, ts, 60_000)).toBe(false);
  });

  it("treats a null/undefined signal as not stale", () => {
    expect(isStale(NOW, null, 60_000)).toBe(false);
    expect(isStale(NOW, undefined, 60_000)).toBe(false);
  });
});

describe("newestSignal (EP-8DC217EB BET-10)", () => {
  it("returns the largest timestamp, ignoring null/undefined", () => {
    const a = new Date("2026-07-09T10:00:00.000Z");
    const b = new Date("2026-07-09T11:30:00.000Z");
    const c = new Date("2026-07-09T09:00:00.000Z");
    expect(newestSignal(a, null, b, undefined, c)).toBe(b);
  });

  it("returns null when every signal is absent", () => {
    expect(newestSignal(null, undefined)).toBeNull();
    expect(newestSignal()).toBeNull();
  });

  it("returns the single present signal", () => {
    const only = new Date("2026-07-09T08:00:00.000Z");
    expect(newestSignal(null, only, undefined)).toBe(only);
  });
});
