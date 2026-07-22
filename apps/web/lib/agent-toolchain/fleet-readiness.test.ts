import { describe, it, expect } from "vitest";

import {
  evaluateFleetReadiness,
  isSurfaceReadinessState,
  isSurfaceClientKind,
  type SurfaceReadinessRow,
} from "./fleet-readiness";

const NOW = new Date("2026-07-21T12:00:00Z");
const STALE_AFTER = 7 * 24 * 60 * 60 * 1000; // 7 days

function row(over: Partial<SurfaceReadinessRow> = {}): SurfaceReadinessRow {
  return {
    surfaceKey: "claude-code@machine-1",
    clientKind: "claude-code",
    readinessState: "ready",
    dpfPlatformVersion: "1.2.3",
    mcpOk: true,
    mcpReason: null,
    reportedAt: new Date("2026-07-21T11:00:00Z"), // fresh (1h ago)
    ...over,
  };
}

describe("evaluateFleetReadiness", () => {
  it("marks a fresh, ready surface as ready", () => {
    const r = evaluateFleetReadiness([row()], { now: NOW, staleAfterMs: STALE_AFTER });
    expect(r.surfaces[0].status).toBe("ready");
    expect(r.allReady).toBe(true);
    expect(r.needsAttention).toEqual([]);
    expect(r.counts).toEqual({ ready: 1, notReady: 0, stale: 0, total: 1 });
  });

  it("marks a fresh but not-ready surface (any non-'ready' state) as not-ready", () => {
    const r = evaluateFleetReadiness(
      [row({ readinessState: "missing_token", mcpOk: false, mcpReason: "no_token" })],
      { now: NOW, staleAfterMs: STALE_AFTER },
    );
    expect(r.surfaces[0].status).toBe("not-ready");
    expect(r.allReady).toBe(false);
    expect(r.needsAttention).toHaveLength(1);
    expect(r.counts.notReady).toBe(1);
  });

  it("marks a silent (heartbeat older than the window) surface as stale, even if last state was ready", () => {
    const r = evaluateFleetReadiness(
      [row({ readinessState: "ready", reportedAt: new Date("2026-07-10T00:00:00Z") })], // >7d ago
      { now: NOW, staleAfterMs: STALE_AFTER },
    );
    // absence-is-stale-not-current: a ready state we can no longer confirm is NOT counted ready
    expect(r.surfaces[0].status).toBe("stale");
    expect(r.counts.stale).toBe(1);
    expect(r.needsAttention).toHaveLength(1);
    expect(r.allReady).toBe(false);
  });

  it("flags behindVersion when an expected platform version is supplied", () => {
    const r = evaluateFleetReadiness([row({ dpfPlatformVersion: "1.0.0" })], {
      now: NOW,
      staleAfterMs: STALE_AFTER,
      expectedPlatformVersion: "1.2.3",
    });
    expect(r.surfaces[0].behindVersion).toBe(true);
    // still ready by state, but the drift is visible
    expect(r.surfaces[0].status).toBe("ready");
  });

  it("does not flag behindVersion without an expected version, or when up to date", () => {
    const noExpected = evaluateFleetReadiness([row({ dpfPlatformVersion: "1.0.0" })], {
      now: NOW,
      staleAfterMs: STALE_AFTER,
    });
    expect(noExpected.surfaces[0].behindVersion).toBe(false);
    const upToDate = evaluateFleetReadiness([row({ dpfPlatformVersion: "1.2.3" })], {
      now: NOW,
      staleAfterMs: STALE_AFTER,
      expectedPlatformVersion: "1.2.3",
    });
    expect(upToDate.surfaces[0].behindVersion).toBe(false);
  });

  it("rolls up a mixed fleet: ready + not-ready + stale", () => {
    const r = evaluateFleetReadiness(
      [
        row({ surfaceKey: "claude-code@m1", readinessState: "ready" }),
        row({ surfaceKey: "codex@m1", readinessState: "missing_token" }),
        row({ surfaceKey: "grok@m2", readinessState: "ready", reportedAt: new Date("2026-07-01T00:00:00Z") }),
      ],
      { now: NOW, staleAfterMs: STALE_AFTER },
    );
    expect(r.counts).toEqual({ ready: 1, notReady: 1, stale: 1, total: 3 });
    expect(r.allReady).toBe(false);
    expect(r.needsAttention.map((s) => s.surfaceKey).sort()).toEqual(["codex@m1", "grok@m2"]);
  });

  it("allReady is false for an empty fleet (we cannot claim readiness we never observed)", () => {
    const r = evaluateFleetReadiness([], { now: NOW, staleAfterMs: STALE_AFTER });
    expect(r.allReady).toBe(false);
    expect(r.counts.total).toBe(0);
  });

  it("validates the readiness-state and client-kind vocabularies", () => {
    expect(isSurfaceReadinessState("ready")).toBe(true);
    expect(isSurfaceReadinessState("bogus")).toBe(false);
    expect(isSurfaceClientKind("claude-code")).toBe(true);
    expect(isSurfaceClientKind("build-studio")).toBe(true);
    expect(isSurfaceClientKind("nope")).toBe(false);
  });
});
