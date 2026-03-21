/**
 * EP-INF-006: Reward function tests (TDD).
 * See: docs/superpowers/specs/2026-03-18-ai-routing-and-profiling-design.md
 */

import { describe, expect, it } from "vitest";
import {
  computeReward,
  DEFAULT_REWARD_WEIGHTS,
  type OutcomeSignals,
} from "./reward";

// ── Fixtures ─────────────────────────────────────────────────────────────────

const POSITIVE_SIGNALS: OutcomeSignals = {
  graderScore: 0.9,
  humanScore: 0.8,
  schemaValid: true,
  toolSuccess: true,
  latencyMs: 500,
  costUsd: 0.01,
  providerErrorCode: null,
};

const NEUTRAL_SIGNALS: OutcomeSignals = {
  graderScore: null,
  humanScore: null,
  schemaValid: null,
  toolSuccess: null,
  latencyMs: 100,
  costUsd: null,
  providerErrorCode: null,
};

// ── Hard failure cases ────────────────────────────────────────────────────────

describe("computeReward — hard failures → 0", () => {
  it("returns 0 when providerErrorCode is set", () => {
    const signals: OutcomeSignals = { ...POSITIVE_SIGNALS, providerErrorCode: "rate_limit" };
    expect(computeReward(signals)).toBe(0);
  });

  it("returns 0 when providerErrorCode is a non-empty string (other code)", () => {
    const signals: OutcomeSignals = { ...POSITIVE_SIGNALS, providerErrorCode: "500" };
    expect(computeReward(signals)).toBe(0);
  });

  it("returns 0 when schemaValid is false", () => {
    const signals: OutcomeSignals = { ...POSITIVE_SIGNALS, schemaValid: false };
    expect(computeReward(signals)).toBe(0);
  });

  it("returns 0 when toolSuccess is false", () => {
    const signals: OutcomeSignals = { ...POSITIVE_SIGNALS, toolSuccess: false };
    expect(computeReward(signals)).toBe(0);
  });
});

// ── Null / neutral handling ───────────────────────────────────────────────────

describe("computeReward — null signals treated as neutral 0.5", () => {
  it("null graderScore is treated as 0.5", () => {
    const withNull: OutcomeSignals = { ...POSITIVE_SIGNALS, graderScore: null };
    const withHalf: OutcomeSignals = { ...POSITIVE_SIGNALS, graderScore: 0.5 };
    expect(computeReward(withNull)).toBeCloseTo(computeReward(withHalf), 10);
  });

  it("null humanScore is treated as 0.5", () => {
    const withNull: OutcomeSignals = { ...POSITIVE_SIGNALS, humanScore: null };
    const withHalf: OutcomeSignals = { ...POSITIVE_SIGNALS, humanScore: 0.5 };
    expect(computeReward(withNull)).toBeCloseTo(computeReward(withHalf), 10);
  });

  it("null costUsd is treated as neutral 0.5", () => {
    const withNull: OutcomeSignals = { ...POSITIVE_SIGNALS, costUsd: null };
    const withHalf: OutcomeSignals = {
      ...POSITIVE_SIGNALS,
      // costUsd that maps to 0.5: 1 - (x/0.10) = 0.5 → x = 0.05
      costUsd: 0.05,
    };
    expect(computeReward(withNull)).toBeCloseTo(computeReward(withHalf), 10);
  });
});

// ── Latency component ─────────────────────────────────────────────────────────

describe("computeReward — latency component", () => {
  it("high latency (30000ms) yields latency component ≈ 0", () => {
    // At 30 000 ms the latency component = max(0, 1 - 30000/30000) = 0
    // Isolate by using neutral signals and checking the weighted contribution
    const signals: OutcomeSignals = { ...NEUTRAL_SIGNALS, latencyMs: 30_000 };
    const w = DEFAULT_REWARD_WEIGHTS;
    // All components neutral (0.5) except latency=0
    // expected = 0.5*(quality+correctness+human) + 0*latency + 0.5*cost
    //          = 0.5*(w.quality + w.correctness + w.humanFeedback + w.cost) + 0
    const expected =
      0.5 * (w.quality + w.correctness + w.humanFeedback + w.cost) +
      0 * w.latency;
    expect(computeReward(signals)).toBeCloseTo(expected, 5);
  });

  it("low latency (100ms) yields latency component ≈ 1", () => {
    // At 100 ms: 1 - 100/30000 ≈ 0.9967
    const signals: OutcomeSignals = { ...NEUTRAL_SIGNALS, latencyMs: 100 };
    const latencyComponent = Math.max(0, 1 - 100 / 30_000);
    const w = DEFAULT_REWARD_WEIGHTS;
    const expected =
      0.5 * (w.quality + w.correctness + w.humanFeedback + w.cost) +
      latencyComponent * w.latency;
    expect(computeReward(signals)).toBeCloseTo(expected, 5);
  });
});

// ── Cost component ────────────────────────────────────────────────────────────

describe("computeReward — cost component", () => {
  it("high cost ($0.10) yields cost component ≈ 0", () => {
    const signals: OutcomeSignals = { ...NEUTRAL_SIGNALS, costUsd: 0.1 };
    const w = DEFAULT_REWARD_WEIGHTS;
    const latencyComponent = Math.max(0, 1 - 100 / 30_000);
    // costComponent = max(0, 1 - 0.10/0.10) = 0
    const expected =
      0.5 * (w.quality + w.correctness + w.humanFeedback) +
      latencyComponent * w.latency +
      0 * w.cost;
    expect(computeReward(signals)).toBeCloseTo(expected, 5);
  });

  it("zero cost yields cost component = 1", () => {
    const signals: OutcomeSignals = { ...NEUTRAL_SIGNALS, costUsd: 0 };
    const w = DEFAULT_REWARD_WEIGHTS;
    const latencyComponent = Math.max(0, 1 - 100 / 30_000);
    // costComponent = max(0, 1 - 0/0.10) = 1
    const expected =
      0.5 * (w.quality + w.correctness + w.humanFeedback) +
      latencyComponent * w.latency +
      1 * w.cost;
    expect(computeReward(signals)).toBeCloseTo(expected, 5);
  });
});

// ── All positive signals ──────────────────────────────────────────────────────

describe("computeReward — positive signals", () => {
  it("all positive signals return a composite between 0 and 1", () => {
    const result = computeReward(POSITIVE_SIGNALS);
    expect(result).toBeGreaterThan(0);
    expect(result).toBeLessThanOrEqual(1);
  });

  it("higher graderScore produces higher reward (all else equal)", () => {
    const low: OutcomeSignals = { ...POSITIVE_SIGNALS, graderScore: 0.2 };
    const high: OutcomeSignals = { ...POSITIVE_SIGNALS, graderScore: 0.9 };
    expect(computeReward(high)).toBeGreaterThan(computeReward(low));
  });
});

// ── All neutral → ≈ 0.5 ──────────────────────────────────────────────────────

describe("computeReward — all neutral", () => {
  it("all nulls with low latency (100ms) returns reward ≈ 0.5", () => {
    // Each component:
    //   quality=0.5, correctness=0.5, latency≈1.0 (100ms), cost=0.5, humanFeedback=0.5
    // weighted sum ≈ 0.5*0.45 + 0.5*0.25 + ~1*0.10 + 0.5*0.10 + 0.5*0.10
    //              = 0.225 + 0.125 + 0.0997 + 0.05 + 0.05 ≈ 0.5497
    // So it's near 0.5 but slightly above due to the good latency; test for > 0.45 and < 0.65
    const result = computeReward(NEUTRAL_SIGNALS);
    expect(result).toBeGreaterThan(0.45);
    expect(result).toBeLessThan(0.65);
  });

  it("all nulls with 15000ms latency (midpoint) returns reward ≈ 0.5", () => {
    // latencyComponent = 1 - 15000/30000 = 0.5 → all components 0.5 → reward = 0.5
    const signals: OutcomeSignals = { ...NEUTRAL_SIGNALS, latencyMs: 15_000 };
    expect(computeReward(signals)).toBeCloseTo(0.5, 5);
  });
});

// ── Default weights ───────────────────────────────────────────────────────────

describe("DEFAULT_REWARD_WEIGHTS", () => {
  it("weights sum to 1.0", () => {
    const sum = Object.values(DEFAULT_REWARD_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1.0, 10);
  });
});
