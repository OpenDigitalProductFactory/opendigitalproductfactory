import { describe, expect, it, vi } from "vitest";

import { decideWithBoundedRetry } from "./uncertain-retry";
import type { DecisionResult } from "./option-scoring";

const result = (over: {
  verdict?: "proceed" | "uncertain" | "decline";
  cause?: string | null;
  none?: boolean;
}): DecisionResult => ({
  recommendation: over.none ? null : {
    optionId: "a",
    composite: 0.5,
    margin: 0.1,
    confidence: over.verdict === "proceed" ? "high" : "low",
    verdict: over.verdict ?? "uncertain",
    verdictCause: (over.cause ?? "low-margin") as never,
    bands: { upper: 0.2, lower: -0.2, stakes: "elevated" },
  },
  scores: [],
  flags: {
    tieMargin: 0.2,
    semanticFallbackRatio: 0,
    structuredCoverage: "strong",
    commandmentConflict: false,
    commandmentConflictPrinciples: [],
  },
  reasoning: "",
});

describe("BI-60B3D270 — the uncertain band has an exit that is not a human", () => {
  it("returns an assurance untouched, without spending an attempt", () => {
    const nextAttempt = vi.fn();
    const out = decideWithBoundedRetry(result({ verdict: "proceed", cause: null }), { nextAttempt });
    expect(out.assured).toBe(true);
    expect(out.attempts).toEqual([]);
    expect(nextAttempt).not.toHaveBeenCalled();
  });

  it("retries an uncertain verdict and stops as soon as it becomes an assurance", () => {
    const out = decideWithBoundedRetry(result({ verdict: "uncertain" }), {
      nextAttempt: () => ({ changed: "added discriminating features", result: result({ verdict: "proceed", cause: null }) }),
    });
    expect(out.assured).toBe(true);
    expect(out.attempts).toEqual([
      { attempt: 1, cause: "low-margin", changed: "added discriminating features", verdict: "proceed" },
    ]);
  });

  it("never retries a commandment conflict — no change resolves it", () => {
    const nextAttempt = vi.fn();
    const out = decideWithBoundedRetry(
      result({ verdict: "uncertain", cause: "commandment-conflict" }),
      { nextAttempt },
    );
    expect(out.stopReason).toBe("not-retryable");
    expect(nextAttempt).not.toHaveBeenCalled();
  });

  it("refuses a retry that changes nothing, rather than proving the same answer twice", () => {
    const out = decideWithBoundedRetry(result({ verdict: "uncertain" }), {
      nextAttempt: () => ({ changed: "   ", result: result({ verdict: "proceed", cause: null }) }),
    });
    expect(out.stopReason).toBe("unchanged-input");
    expect(out.attempts).toEqual([]);
  });

  it("treats a repeated change as no change", () => {
    const out = decideWithBoundedRetry(result({ verdict: "uncertain" }), {
      maxAttempts: 3,
      nextAttempt: () => ({ changed: "same tweak", result: result({ verdict: "uncertain" }) }),
    });
    expect(out.stopReason).toBe("unchanged-input");
    expect(out.attempts).toHaveLength(1);
  });

  it("is bounded — an unbounded loop is a hang wearing the costume of diligence", () => {
    let n = 0;
    const out = decideWithBoundedRetry(result({ verdict: "uncertain" }), {
      maxAttempts: 2,
      nextAttempt: () => ({ changed: `change ${(n += 1)}`, result: result({ verdict: "uncertain" }) }),
    });
    expect(out.stopReason).toBe("attempts-exhausted");
    expect(out.attempts).toHaveLength(2);
    expect(out.assured).toBe(false);
  });

  it("stops when the caller has nothing left to change", () => {
    const out = decideWithBoundedRetry(result({ verdict: "uncertain" }), { nextAttempt: () => null });
    expect(out.stopReason).toBe("no-change-offered");
  });

  it("does not retry a result that weighed nothing — that is a corpus gap, not a close call", () => {
    const nextAttempt = vi.fn();
    const out = decideWithBoundedRetry(result({ none: true }), { nextAttempt });
    expect(out.stopReason).toBe("not-retryable");
    expect(nextAttempt).not.toHaveBeenCalled();
  });

  it("records every attempt with its cause and what changed", () => {
    let n = 0;
    const out = decideWithBoundedRetry(result({ verdict: "uncertain", cause: "coverage-weak" }), {
      maxAttempts: 3,
      nextAttempt: () => ({ changed: `richer features ${(n += 1)}`, result: n >= 2 ? result({ verdict: "decline", cause: "all-options-opposed" }) : result({ verdict: "uncertain", cause: "coverage-weak" }) }),
    });
    expect(out.assured).toBe(true);
    expect(out.attempts.map((a) => a.changed)).toEqual(["richer features 1", "richer features 2"]);
    expect(out.attempts[0]!.cause).toBe("coverage-weak");
  });
});
