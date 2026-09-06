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
  WORKTREE_JANITOR_MAX_FLAG,
  scanKeptForUnknownLiveness,
  DEFAULT_MAX_WORKTREES,
  resolveMaxWorktrees,
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
    if (result.skipped || "healthy" in result) throw new Error("expected summary");
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
    if (result.skipped || "healthy" in result) throw new Error("expected summary");
    expect(result.mode).toBe("live");
    expect(result.removed).toBe(2);
  });

  // This test used to assert `skipped: true` for an unreachable scan. That was
  // the defect, not the contract: a backstop that cannot see its subject
  // reported the same shape as one that had nothing to do, so a blind janitor
  // looked healthy while 528 GB accumulated behind it (BI-99395B29).
  it("reports UNHEALTHY, not skipped, when it cannot see its worktree base", async () => {
    const runScan = vi.fn(async (): Promise<ScanOutcome> => ({
      available: false,
      reason: "could not resolve git root",
    }));
    const result = await runWorktreeJanitor({ env: ENABLED, runScan });

    expect(result.skipped).toBe(false);
    if (result.skipped) throw new Error("expected an unhealthy result, not a skip");
    expect("healthy" in result && result.healthy === false).toBe(true);
    if (!("healthy" in result)) throw new Error("expected the unhealthy shape");
    expect(result.reason).toMatch(/git root/);
  });

  it("is distinguishable from a benign disabled skip", async () => {
    // The whole point: "switched off" and "on but blind" must not look alike.
    const blind = await runWorktreeJanitor({
      env: ENABLED,
      runScan: vi.fn(async (): Promise<ScanOutcome> => ({ available: false, reason: "no host view" })),
    });
    const off = await runWorktreeJanitor({
      env: {},
      runScan: vi.fn(async () => scanOutcome()),
    });

    expect(off.skipped).toBe(true);
    expect(blind.skipped).toBe(false);
  });

  it("reaps Tier-A above the bound without waiting for a decision", async () => {
    // The commandment's operative half: a default that needs a technical
    // decision from a non-technical owner is a deferred outage, not a safe
    // default. Over the bound, the run goes live on its own.
    const modes: string[] = [];
    const runScan = vi.fn(async (mode: "dry-run" | "live") => {
      modes.push(mode);
      return scanOutcome(mode);
    });
    const result = await runWorktreeJanitor({
      env: { ...ENABLED, [WORKTREE_JANITOR_MAX_FLAG]: "1" },
      runScan,
    });

    expect(modes).toEqual(["dry-run", "live"]);
    expect(result.skipped).toBe(false);
    if (result.skipped || "healthy" in result) throw new Error("expected a summary");
    expect(result.mode).toBe("live");
  });

  it("stays in observe mode over the bound when liveness could not be read", async () => {
    // The bound shipped in #4987 would otherwise reap automatically on a scan
    // whose liveness picture was incomplete — which is how a dormant classifier
    // flaw becomes fleet-wide damage.
    const modes: string[] = [];
    const runScan = vi.fn(async (mode: "dry-run" | "live") => {
      modes.push(mode);
      const outcome = scanOutcome(mode);
      if (outcome.available) {
        outcome.scan.decisions = [
          {
            path: "/wt/unknown",
            branch: "fix/x",
            verdict: "KEEP",
            reason: "Workroom claims unreadable (no token) — refusing to reap on absent evidence",
            tier: null,
          },
        ];
      }
      return outcome;
    });

    const result = await runWorktreeJanitor({
      env: { ...ENABLED, [WORKTREE_JANITOR_MAX_FLAG]: "0" },
      runScan,
    });

    expect(modes).toEqual(["dry-run"]);
    expect(result.skipped).toBe(false);
    if (result.skipped || "healthy" in result) throw new Error("expected a summary");
    expect(result.mode).toBe("dry-run");
  });

  it("detects a scan that kept work for unknown liveness", () => {
    expect(
      scanKeptForUnknownLiveness({
        mode: "dry-run",
        available: true,
        decisions: [
          { path: "/a", branch: "b", verdict: "KEEP", reason: "refusing to reap on absent evidence", tier: null },
        ],
      } as never),
    ).toBe(true);
    expect(
      scanKeptForUnknownLiveness({
        mode: "dry-run",
        available: true,
        decisions: [{ path: "/a", branch: "b", verdict: "KEEP", reason: "open PR", tier: null }],
      } as never),
    ).toBe(false);
  });

  it("stays an observation while under the bound", async () => {
    const modes: string[] = [];
    const runScan = vi.fn(async (mode: "dry-run" | "live") => {
      modes.push(mode);
      return scanOutcome(mode);
    });
    const result = await runWorktreeJanitor({
      env: { ...ENABLED, [WORKTREE_JANITOR_MAX_FLAG]: "999" },
      runScan,
    });

    expect(modes).toEqual(["dry-run"]);
    expect(result.skipped).toBe(false);
    if (result.skipped || "healthy" in result) throw new Error("expected a summary");
    expect(result.mode).toBe("dry-run");
  });

  it("falls back to the default bound rather than disabling it on a malformed value", () => {
    // A typo'd bound must not silently mean "never reap".
    expect(resolveMaxWorktrees({ [WORKTREE_JANITOR_MAX_FLAG]: "abc" })).toBe(DEFAULT_MAX_WORKTREES);
    expect(resolveMaxWorktrees({ [WORKTREE_JANITOR_MAX_FLAG]: "0" })).toBe(DEFAULT_MAX_WORKTREES);
    expect(resolveMaxWorktrees({ [WORKTREE_JANITOR_MAX_FLAG]: "  " })).toBe(DEFAULT_MAX_WORKTREES);
    expect(resolveMaxWorktrees({ [WORKTREE_JANITOR_MAX_FLAG]: "12" })).toBe(12);
  });
});
