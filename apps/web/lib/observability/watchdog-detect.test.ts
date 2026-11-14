import { describe, expect, it } from "vitest";
import { decideStall, shouldSurfaceBuildFailure, type WatchdogCandidate } from "./watchdog-detect";
import type { ResolvedThreshold } from "./threshold-lookup";

const NOW = new Date("2026-05-20T00:00:00Z");
const TH: ResolvedThreshold = {
  scope: "phase.ideate",
  heartbeatTimeoutSeconds: 90,
  totalPhaseTimeoutSeconds: 900,
};

function candidate(opts: {
  startedAgoMs: number;
  heartbeatAgoMs: number | null;
  source?: string | null;
}): WatchdogCandidate {
  return {
    taskRunId: "TR-X",
    buildId: "FB-X",
    phase: "ideate",
    startedAt: new Date(NOW.getTime() - opts.startedAgoMs),
    lastHeartbeatAt:
      opts.heartbeatAgoMs === null ? null : new Date(NOW.getTime() - opts.heartbeatAgoMs),
    source: opts.source ?? "build",
  };
}

describe("shouldSurfaceBuildFailure", () => {
  const base = { buildId: "FB-1", phase: "build", source: "build" };

  it("surfaces a build failure for the real build-execution run (source=build) in the build phase", () => {
    expect(shouldSurfaceBuildFailure(base, true)).toBe(true);
  });

  it("does NOT fail the build when a leaked deliberation run stalls (source=proactive)", () => {
    // The exact FB-B7BA303E regression: codex finished correct code, but a
    // leaked "Deliberation: review" run (source=proactive, same buildId) stalled
    // while the build was in phase=build. It must NOT mark the build failed.
    expect(shouldSurfaceBuildFailure({ ...base, source: "proactive" }, true)).toBe(false);
  });

  it("does NOT fail the build for a null-source run", () => {
    expect(shouldSurfaceBuildFailure({ ...base, source: null }, true)).toBe(false);
  });

  it("does NOT surface for non-build phases even for a build-source run", () => {
    expect(shouldSurfaceBuildFailure({ ...base, phase: "ideate" }, true)).toBe(false);
  });

  it("does NOT surface when the FeatureBuild row is gone (buildId dangling)", () => {
    expect(shouldSurfaceBuildFailure(base, false)).toBe(false);
  });

  it("does NOT surface when buildId is null", () => {
    expect(shouldSurfaceBuildFailure({ ...base, buildId: null }, true)).toBe(false);
  });
});

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

// BI-4FDE4050: time the host spent asleep is not silence from the run.
describe("decideStall under host suspension", () => {
  it("does not time out a heartbeat that went quiet only because the host slept", () => {
    // 9 min since the last beat on the wall clock, of which 8.5 min were host sleep.
    const slept = () => 510_000;
    expect(decideStall(candidate({ startedAgoMs: 600_000, heartbeatAgoMs: 540_000 }), TH, NOW, slept)).toBeNull();
  });
  it("does not report never_started while the host slept through the first beat", () => {
    expect(decideStall(candidate({ startedAgoMs: 300_000, heartbeatAgoMs: null }), TH, NOW, () => 280_000)).toBeNull();
  });
  it("still times out a run that is silent for the window in process time", () => {
    const d = decideStall(candidate({ startedAgoMs: 600_000, heartbeatAgoMs: 540_000 }), TH, NOW, () => 400_000);
    expect(d?.reason).toBe("heartbeat_timeout");
  });
  it("keeps the total budget on the wall clock", () => {
    const d = decideStall(candidate({ startedAgoMs: 1_000_000, heartbeatAgoMs: 10_000 }), TH, NOW, () => 900_000);
    expect(d?.reason).toBe("total_timeout");
  });
});
