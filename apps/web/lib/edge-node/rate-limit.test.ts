import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  _resetEdgeRateLimits,
  checkEdgeRateLimit,
  getEdgeRateLimitCeilings,
} from "./rate-limit";

beforeEach(() => {
  _resetEdgeRateLimits();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("checkEdgeRateLimit — heartbeat (12/min)", () => {
  it("allows the first request and reports 11 remaining", () => {
    const result = checkEdgeRateLimit("edge.heartbeat", "node_1");
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(11);
  });

  it("allows up to 12 requests within a minute", () => {
    for (let i = 0; i < 12; i++) {
      const result = checkEdgeRateLimit("edge.heartbeat", "node_1");
      expect(result.allowed).toBe(true);
    }
  });

  it("rejects the 13th request with retryAfter set", () => {
    for (let i = 0; i < 12; i++) {
      checkEdgeRateLimit("edge.heartbeat", "node_1");
    }
    const result = checkEdgeRateLimit("edge.heartbeat", "node_1");
    expect(result.allowed).toBe(false);
    expect(result.retryAfter).toBeGreaterThan(0);
    expect(result.retryAfter).toBeLessThanOrEqual(60);
  });

  it("retryAfter never returns 0 (clients must wait at least 1s)", () => {
    for (let i = 0; i < 12; i++) {
      checkEdgeRateLimit("edge.heartbeat", "node_1");
    }
    const result = checkEdgeRateLimit("edge.heartbeat", "node_1");
    if (!result.allowed) {
      expect(result.retryAfter).toBeGreaterThanOrEqual(1);
    } else {
      throw new Error("expected rate limit to fire");
    }
  });

  it("rejected calls do not consume bucket slots", () => {
    for (let i = 0; i < 12; i++) {
      checkEdgeRateLimit("edge.heartbeat", "node_1");
    }
    // First rejection.
    expect(checkEdgeRateLimit("edge.heartbeat", "node_1").allowed).toBe(false);
    // Subsequent rejections within the same window also reject. If the
    // rejected ones consumed slots, we'd see retryAfter creep up; the
    // contract is: rejected = bucket unchanged.
    const r1 = checkEdgeRateLimit("edge.heartbeat", "node_1");
    const r2 = checkEdgeRateLimit("edge.heartbeat", "node_1");
    expect(r1.allowed).toBe(false);
    expect(r2.allowed).toBe(false);
    // retryAfter from r2 should not be larger than r1's — bucket
    // unchanged means the oldest-timestamp anchor doesn't drift.
    expect(r2.retryAfter!).toBeLessThanOrEqual(r1.retryAfter!);
  });

  it("buckets are keyed per (route, edgeNodeId) — different nodes don't interfere", () => {
    for (let i = 0; i < 12; i++) {
      checkEdgeRateLimit("edge.heartbeat", "node_1");
    }
    expect(checkEdgeRateLimit("edge.heartbeat", "node_1").allowed).toBe(false);
    // Different node has its own bucket.
    expect(checkEdgeRateLimit("edge.heartbeat", "node_2").allowed).toBe(true);
  });

  it("buckets are scoped per route — heartbeat exhausted does not block discovery", () => {
    for (let i = 0; i < 12; i++) {
      checkEdgeRateLimit("edge.heartbeat", "node_1");
    }
    expect(checkEdgeRateLimit("edge.heartbeat", "node_1").allowed).toBe(false);
    // Same node, different route.
    expect(checkEdgeRateLimit("edge.discovery_runs.submit", "node_1").allowed).toBe(true);
  });

  it("releases slots after the window passes", () => {
    vi.useFakeTimers();
    const start = new Date("2026-05-12T12:00:00Z");
    vi.setSystemTime(start);
    for (let i = 0; i < 12; i++) {
      checkEdgeRateLimit("edge.heartbeat", "node_1");
    }
    expect(checkEdgeRateLimit("edge.heartbeat", "node_1").allowed).toBe(false);
    // Advance just past the 60s window.
    vi.setSystemTime(new Date(start.getTime() + 61_000));
    expect(checkEdgeRateLimit("edge.heartbeat", "node_1").allowed).toBe(true);
  });
});

describe("checkEdgeRateLimit — discovery-runs (4/min + 60/hour)", () => {
  it("allows up to 4 within a minute", () => {
    for (let i = 0; i < 4; i++) {
      const result = checkEdgeRateLimit("edge.discovery_runs.submit", "node_1");
      expect(result.allowed).toBe(true);
    }
    expect(
      checkEdgeRateLimit("edge.discovery_runs.submit", "node_1").allowed,
    ).toBe(false);
  });

  it("enforces the 60/hour ceiling even when the per-minute ceiling resets", () => {
    vi.useFakeTimers();
    const start = new Date("2026-05-12T12:00:00Z");
    vi.setSystemTime(start);

    // Spread 60 submissions across the hour, 4 per minute (the per-
    // minute ceiling), then attempt one more. Advance by 61s between
    // minutes so the previous minute's 4 fall just OUT of the
    // per-minute window (the window check is inclusive on `>=`, so
    // exactly 60_000ms would still count toward the per-minute total).
    for (let minute = 0; minute < 15; minute++) {
      vi.setSystemTime(new Date(start.getTime() + minute * 61_000));
      for (let i = 0; i < 4; i++) {
        const r = checkEdgeRateLimit("edge.discovery_runs.submit", "node_1");
        expect(r.allowed).toBe(true);
      }
    }
    // 60 submissions in the past ~15 minutes (well under an hour) now.
    // The 61st should be rejected by the per-hour ceiling.
    vi.setSystemTime(new Date(start.getTime() + 15 * 61_000 + 1_000));
    const r = checkEdgeRateLimit("edge.discovery_runs.submit", "node_1");
    expect(r.allowed).toBe(false);
    // retryAfter must be > 0 and bounded by the per-hour window (3600s).
    expect(r.retryAfter).toBeGreaterThan(0);
    expect(r.retryAfter).toBeLessThanOrEqual(3600);
  });

  it("4/min stricter window fires before the 60/hour window when both apply", () => {
    // 4 fast submissions trip the per-minute ceiling. retryAfter
    // should be bounded by the per-minute window (60s), not the
    // per-hour window (3600s).
    for (let i = 0; i < 4; i++) {
      checkEdgeRateLimit("edge.discovery_runs.submit", "node_1");
    }
    const r = checkEdgeRateLimit("edge.discovery_runs.submit", "node_1");
    expect(r.allowed).toBe(false);
    expect(r.retryAfter).toBeLessThanOrEqual(60);
  });
});

describe("getEdgeRateLimitCeilings", () => {
  it("exposes heartbeat ceiling as 12/min", () => {
    const ceilings = getEdgeRateLimitCeilings("edge.heartbeat");
    expect(ceilings).toHaveLength(1);
    expect(ceilings[0]).toEqual({ limit: 12, windowMs: 60_000 });
  });

  it("exposes discovery ceilings as 4/min + 60/hour", () => {
    const ceilings = getEdgeRateLimitCeilings("edge.discovery_runs.submit");
    expect(ceilings).toHaveLength(2);
    expect(ceilings).toContainEqual({ limit: 4, windowMs: 60_000 });
    expect(ceilings).toContainEqual({ limit: 60, windowMs: 60 * 60_000 });
  });

  it("returned array reflects policy snapshot at time of call", () => {
    // Calling repeatedly returns equivalent ceilings (no mutation).
    const a = getEdgeRateLimitCeilings("edge.heartbeat");
    const b = getEdgeRateLimitCeilings("edge.heartbeat");
    expect(b).toEqual(a);
  });
});

describe("_resetEdgeRateLimits", () => {
  it("clears all bucket state", () => {
    for (let i = 0; i < 12; i++) {
      checkEdgeRateLimit("edge.heartbeat", "node_1");
    }
    expect(checkEdgeRateLimit("edge.heartbeat", "node_1").allowed).toBe(false);
    _resetEdgeRateLimits();
    expect(checkEdgeRateLimit("edge.heartbeat", "node_1").allowed).toBe(true);
  });
});
