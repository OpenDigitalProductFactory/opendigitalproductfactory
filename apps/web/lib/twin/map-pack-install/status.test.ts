import { describe, expect, it } from "vitest";

import { IDLE_INSTALL, STALE_MS, isInstallRunning, isInstallStalled, parseInstallStatus } from "./status";

describe("map pack install status (BI-43BBCC26)", () => {
  const now = Date.parse("2026-11-03T18:00:00Z");
  const at = (msAgo: number) => new Date(now - msAgo).toISOString();

  it("counts an in-flight state with recent progress as running", () => {
    const s = { ...IDLE_INSTALL, state: "downloading" as const, updatedAt: at(60_000) };
    expect(isInstallRunning(s, now)).toBe(true);
    expect(isInstallStalled(s, now)).toBe(false);
  });

  it("treats a run with no progress for the stale window as stalled, not running", () => {
    const s = { ...IDLE_INSTALL, state: "downloading" as const, updatedAt: at(STALE_MS + 1) };
    expect(isInstallRunning(s, now)).toBe(false);
    expect(isInstallStalled(s, now)).toBe(true);
  });

  it("never counts done, failed or idle as running or stalled", () => {
    for (const state of ["idle", "done", "failed"] as const) {
      const s = { ...IDLE_INSTALL, state, updatedAt: at(0) };
      expect(isInstallRunning(s, now)).toBe(false);
      expect(isInstallStalled(s, now)).toBe(false);
    }
  });

  it("reads an unknown state as idle", () => {
    expect(parseInstallStatus({ state: "exploded" }).state).toBe("idle");
  });
});
