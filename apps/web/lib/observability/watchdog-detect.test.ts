import { describe, expect, it } from "vitest";
import { decideStall, type WatchdogCandidate } from "./watchdog-detect";
import type { ResolvedThreshold } from "./threshold-lookup";

const NOW = new Date("2026-05-20T00:00:00Z");
const TH: ResolvedThreshold = {
  scope: "phase.ideate",
  heartbeatTimeoutSeconds: 90,
  totalPhaseTimeoutSeconds: 900,
};

function candidate(opts: { startedAgoMs: number; heartbeatAgoMs: number | null }): WatchdogCandidate {
  return {
    taskRunId: "TR-X",
    buildId: "FB-X",
    phase: "ideate",
    startedAt: new Date(NOW.getTime() - opts.startedAgoMs),
    lastHeartbeatAt:
      opts.heartbeatAgoMs === null ? null : new Date(NOW.getTime() - opts.heartbeatAgoMs),
  };
}

describe("decideStall", () => {
  it("returns null when heartbeat is recent and wall-clock is within budget", () => {
    expect(decideStall(candidate({ startedAgoMs: 60_000, heartbeatAgoMs: 10_000 }), TH, NOW)).toBeNull();
  });

  it("returns heartbeat_timeout when silence exceeds threshold", () => {
    const d = decideStall(candidate({ startedAgoMs: 200_000, heartbeatAgoMs: 100_000 }), TH, NOW);
    expect(d?.reason).toBe("heartbeat_timeout");
  });

  it("returns never_started when lastHeartbeatAt is null and age exceeds threshold", () => {
    const d = decideStall(candidate({ startedAgoMs: 120_000, heartbeatAgoMs: null }), TH, NOW);
    expect(d?.reason).toBe("never_started");
  });

  it("returns null when lastHeartbeatAt is null but age is still within threshold", () => {
    expect(decideStall(candidate({ startedAgoMs: 30_000, heartbeatAgoMs: null }), TH, NOW)).toBeNull();
  });

  it("returns total_timeout when wall-clock age exceeds totalPhaseTimeoutSeconds", () => {
    const d = decideStall(candidate({ startedAgoMs: 1_000_000, heartbeatAgoMs: 10_000 }), TH, NOW);
    expect(d?.reason).toBe("total_timeout");
  });

  it("total_timeout wins over heartbeat_timeout when both would trip", () => {
    // Both > 900s wall-clock AND > 90s silence — total_timeout takes precedence.
    const d = decideStall(candidate({ startedAgoMs: 1_000_000, heartbeatAgoMs: 500_000 }), TH, NOW);
    expect(d?.reason).toBe("total_timeout");
  });
});
