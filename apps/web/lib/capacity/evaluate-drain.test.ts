import { describe, expect, it } from "vitest";
import { mostRestrictiveFreshWeekly } from "./evaluate-drain";
import type { CliPoolState } from "@/lib/routing/cli-pool-status";

const NOW = new Date("2026-07-16T12:00:00Z");

function pool(overrides: Partial<CliPoolState> = {}): CliPoolState {
  return {
    adapterType: "claude-cli",
    providerId: "anthropic-sub",
    rateLimitedAt: NOW,
    resetAt: null,
    retryAfterSeconds: null,
    errorSnippet: null,
    isExhausted: false,
    secondsUntilReset: null,
    weeklyUtilization: null,
    weeklyResetAt: null,
    weeklySource: null,
    weeklyObservedAt: null,
    ...overrides,
  };
}

describe("mostRestrictiveFreshWeekly", () => {
  it("returns null when no pool carries a weekly reading", () => {
    expect(mostRestrictiveFreshWeekly([pool(), pool({ adapterType: "codex-cli" })], NOW)).toBeNull();
  });

  it("picks the most-restrictive (highest utilization) fresh snapshot across adapters", () => {
    const pools: CliPoolState[] = [
      pool({ adapterType: "claude-cli", weeklyUtilization: 0.4, weeklyObservedAt: NOW, weeklySource: "anthropic-unified-headers" }),
      pool({ adapterType: "codex-cli", weeklyUtilization: 0.85, weeklyObservedAt: NOW, weeklySource: "codex-app-server" }),
    ];
    const worst = mostRestrictiveFreshWeekly(pools, NOW);
    expect(worst!.utilization).toBeCloseTo(0.85);
    expect(worst!.source).toBe("codex-app-server");
  });

  it("ignores stale snapshots (a stale read must not read as plenty of quota)", () => {
    const stale = pool({
      weeklyUtilization: 0.9,
      weeklyObservedAt: new Date("2026-07-16T11:00:00Z"), // 60m old > 30m default
      weeklySource: "anthropic-oauth-usage",
    });
    expect(mostRestrictiveFreshWeekly([stale], NOW)).toBeNull();
  });

  it("prefers a fresh snapshot even if a staler one is more restrictive", () => {
    const pools: CliPoolState[] = [
      pool({ adapterType: "claude-cli", weeklyUtilization: 0.99, weeklyObservedAt: new Date("2026-07-16T10:00:00Z") }), // stale
      pool({ adapterType: "codex-cli", weeklyUtilization: 0.3, weeklyObservedAt: NOW }), // fresh
    ];
    const worst = mostRestrictiveFreshWeekly(pools, NOW);
    expect(worst!.utilization).toBeCloseTo(0.3);
  });
});
