// BI-42FA7DD8 — unit tests for scheduled worktree janitor (observe + Tier-A auto-reap).

import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  runWorktreeJanitor,
  assertNoSilentLiveInObserve,
  assertAutoReapIsTierAOnly,
  OBSERVE_ARGS,
  AUTO_REAP_ARGS,
  WORKTREE_JANITOR_ENABLED_FLAG,
  WORKTREE_JANITOR_AUTO_REAP_FLAG,
  type ScanOutcome,
} from "./worktree-janitor";

const ENABLED = { [WORKTREE_JANITOR_ENABLED_FLAG]: "1" };
const AUTO = {
  [WORKTREE_JANITOR_ENABLED_FLAG]: "1",
  [WORKTREE_JANITOR_AUTO_REAP_FLAG]: "1",
};

function scanOutcome(mode: "dry-run" | "live" = "dry-run"): ScanOutcome {
  return {
    available: true,
    scan: {
      mode,
      available: true,
      root: "/host-dpf",
      graceDays: 14,
      policy: "tier-a-only",
      decisions: [],
      summary: {
        counts: { PRUNE_TIER_A: 2, PRUNE_TIER_B: 1, KEEP: 5, SKIP: 1, PINNED: 0 },
        tierAPaths: ["/wt/a", "/wt/b"],
        tierBPaths: ["/wt/stale"],
      },
      removals:
        mode === "live"
          ? [
              { path: "/wt/a", worktreeRemoved: true, branchDeleted: true },
              { path: "/wt/b", worktreeRemoved: true, branchDeleted: false },
            ]
          : [],
    },
  };
}

describe("worktree-janitor schedule invariants (BI-42FA7DD8)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("OBSERVE_ARGS is dry-run tier-a-only json", () => {
    expect([...OBSERVE_ARGS]).toEqual(["--json", "--dry-run", "--tier-a-only"]);
    expect(() => assertNoSilentLiveInObserve(OBSERVE_ARGS)).not.toThrow();
    expect(() => assertNoSilentLiveInObserve(["--json", "--live"])).toThrow(/must not include live/);
  });

  it("AUTO_REAP_ARGS is live tier-a-only", () => {
    expect([...AUTO_REAP_ARGS]).toEqual(["--json", "--live", "--tier-a-only"]);
    expect(() => assertAutoReapIsTierAOnly(AUTO_REAP_ARGS)).not.toThrow();
    expect(() => assertAutoReapIsTierAOnly(["--json", "--live"])).toThrow(/tier-a-only/);
  });

  it("skips when master flag is off", async () => {
    const runScan = vi.fn(async () => scanOutcome());
    const result = await runWorktreeJanitor({ env: {}, runScan });
    expect(result.skipped).toBe(true);
    expect(runScan).not.toHaveBeenCalled();
  });

  it("observe mode when enabled without auto-reap", async () => {
    const runScan = vi.fn(async (mode: "dry-run" | "live") => {
      expect(mode).toBe("dry-run");
      return scanOutcome("dry-run");
    });
    const result = await runWorktreeJanitor({ env: ENABLED, runScan });
    expect(result.skipped).toBe(false);
    if (result.skipped) throw new Error("expected summary");
    expect(result.mode).toBe("dry-run");
    expect(result.tierA).toBe(2);
    expect(result.tierB).toBe(1);
    expect(result.removed).toBe(0);
    expect(result.tierAPaths).toEqual(["/wt/a", "/wt/b"]);
  });

  it("live tier-a mode when AUTO_REAP is on", async () => {
    const runScan = vi.fn(async (mode: "dry-run" | "live") => {
      expect(mode).toBe("live");
      return scanOutcome("live");
    });
    const result = await runWorktreeJanitor({ env: AUTO, runScan });
    expect(result.skipped).toBe(false);
    if (result.skipped) throw new Error("expected summary");
    expect(result.mode).toBe("live");
    expect(result.removed).toBe(2);
  });

  it("skips when scan unavailable", async () => {
    const runScan = vi.fn(async (): Promise<ScanOutcome> => ({
      available: false,
      reason: "could not resolve git root",
    }));
    const result = await runWorktreeJanitor({ env: ENABLED, runScan });
    expect(result.skipped).toBe(true);
    if (!result.skipped) throw new Error("expected skip");
    expect(result.reason).toMatch(/git root/);
  });
});
