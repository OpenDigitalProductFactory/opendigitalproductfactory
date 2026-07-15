import { describe, it, expect, vi } from "vitest";
import {
  isPromoterContainerStale,
  sweepOrphanedPromoterContainers,
  type DockerRun,
} from "./promoter-sweep";

describe("isPromoterContainerStale (orphaned-promoter sweep gate)", () => {
  const now = new Date("2026-07-11T12:20:00Z");
  const maxAge = 30 * 60 * 1000;

  it("treats a promoter older than maxAge as stale (docker CreatedAt format)", () => {
    // Started 11:41:26 UTC, now 12:20 → ~39 min old > 30 min.
    expect(isPromoterContainerStale("2026-07-11 11:41:26 +0000 UTC", now, maxAge)).toBe(true);
  });

  it("does NOT remove a promoter still within the budget (legit in-flight swap)", () => {
    // Started 12:05 → 15 min old < 30 min: a live upgrade must be left alone.
    expect(isPromoterContainerStale("2026-07-11 12:05:00 +0000 UTC", now, maxAge)).toBe(false);
  });

  it("refuses to declare an unparseable stamp stale (never kill what we can't age)", () => {
    expect(isPromoterContainerStale("", now, maxAge)).toBe(false);
    expect(isPromoterContainerStale("not-a-date", now, maxAge)).toBe(false);
  });
});

describe("sweepOrphanedPromoterContainers", () => {
  const now = () => new Date("2026-07-11T12:20:00Z");
  const logger = () => ({ log: vi.fn(), error: vi.fn() });

  it("logs docker-unavailable (ENOENT) quietly, NOT at error level (BI-PIR-ae7f19b6)", async () => {
    const run: DockerRun = async () => {
      throw Object.assign(new Error("spawn docker ENOENT"), { code: "ENOENT" });
    };
    const log = logger();
    const result = await sweepOrphanedPromoterContainers({ run, now }, log);

    expect(result).toBeNull();
    // Quiet info log, and crucially NOT logger.error (which the PIR scanner trips on).
    expect(log.error).not.toHaveBeenCalled();
    expect(log.log).toHaveBeenCalledWith(
      expect.stringContaining("docker CLI unavailable (ENOENT)"),
    );
  });

  it("still surfaces a genuine docker failure at error level", async () => {
    const run: DockerRun = async () => {
      throw Object.assign(new Error("Cannot connect to the Docker daemon"), { code: "1" });
    };
    const log = logger();
    const result = await sweepOrphanedPromoterContainers({ run, now }, log);

    expect(result).toBeNull();
    expect(log.error).toHaveBeenCalledWith(
      expect.stringContaining("[promoter-sweep] failed"),
      expect.anything(),
    );
  });

  it("force-removes only promoters older than maxAge", async () => {
    const calls: string[][] = [];
    const run: DockerRun = async (_file, args) => {
      calls.push(args);
      if (args[0] === "ps") {
        return {
          stdout:
            "dpf-promoter-stale\t2026-07-11 11:41:26 +0000 UTC\n" + // ~39 min → stale
            "dpf-promoter-live\t2026-07-11 12:10:00 +0000 UTC\n", // ~10 min → keep
        };
      }
      return { stdout: "" };
    };
    const log = logger();
    const result = await sweepOrphanedPromoterContainers(
      { run, now, maxAgeMs: 30 * 60 * 1000 },
      log,
    );

    expect(result).toEqual({ removed: 1 });
    const rmCalls = calls.filter((a) => a[0] === "rm");
    expect(rmCalls).toEqual([["rm", "-f", "dpf-promoter-stale"]]);
  });
});
