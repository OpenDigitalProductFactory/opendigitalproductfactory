import { describe, expect, it } from "vitest";
import {
  coerceResetDate,
  deriveRemainingRatio,
  isWeeklyQuotaFresh,
  parseCodexRateLimitsJson,
  parseOAuthUsageJson,
  parseUnifiedRateLimitHeaders,
  type WeeklyQuotaSnapshot,
} from "./weekly-quota";

const OBS = new Date("2026-07-16T12:00:00Z");

describe("coerceResetDate", () => {
  it("parses unix seconds (10-digit)", () => {
    // 2026-07-16T18:00:00Z = 1784224800
    expect(coerceResetDate(1784224800)?.toISOString()).toBe("2026-07-16T18:00:00.000Z");
  });
  it("parses unix seconds as a numeric string", () => {
    expect(coerceResetDate("1784224800")?.toISOString()).toBe("2026-07-16T18:00:00.000Z");
  });
  it("parses unix milliseconds (13-digit)", () => {
    expect(coerceResetDate(1784224800000)?.toISOString()).toBe("2026-07-16T18:00:00.000Z");
  });
  it("parses ISO strings", () => {
    expect(coerceResetDate("2026-07-16T18:00:00Z")?.toISOString()).toBe("2026-07-16T18:00:00.000Z");
  });
  it("returns null for junk / null / non-positive", () => {
    expect(coerceResetDate(null)).toBeNull();
    expect(coerceResetDate("not-a-date")).toBeNull();
    expect(coerceResetDate(0)).toBeNull();
    expect(coerceResetDate(-5)).toBeNull();
  });
});

describe("parseUnifiedRateLimitHeaders", () => {
  it("reads unified-7d utilization + reset from a Headers object", () => {
    const h = new Headers({
      "anthropic-ratelimit-unified-7d-utilization": "0.63",
      "anthropic-ratelimit-unified-7d-reset": "1784224800",
      "anthropic-ratelimit-unified-5h-utilization": "0.10",
    });
    const snap = parseUnifiedRateLimitHeaders(h, OBS);
    expect(snap).not.toBeNull();
    expect(snap!.utilization).toBeCloseTo(0.63);
    expect(snap!.resetAt?.toISOString()).toBe("2026-07-16T18:00:00.000Z");
    expect(snap!.source).toBe("anthropic-unified-headers");
    expect(snap!.observedAt).toBe(OBS);
  });

  it("takes the MOST-RESTRICTIVE weekly window across tier variants", () => {
    const snap = parseUnifiedRateLimitHeaders(
      {
        "anthropic-ratelimit-unified-7d-utilization": "0.40",
        "anthropic-ratelimit-unified-7d-reset": "1784224800",
        "anthropic-ratelimit-unified-7d_opus-utilization": "0.85",
        "anthropic-ratelimit-unified-7d_opus-reset": "1784228400",
      },
      OBS,
    );
    // 7d_opus is more consumed → it's the binding weekly limit.
    expect(snap!.utilization).toBeCloseTo(0.85);
    expect(snap!.resetAt?.toISOString()).toBe("2026-07-16T19:00:00.000Z");
  });

  it("returns null when no weekly header is present (API-key request)", () => {
    const snap = parseUnifiedRateLimitHeaders(
      { "anthropic-ratelimit-unified-5h-utilization": "0.2", "x-ratelimit-remaining-tokens": "5000" },
      OBS,
    );
    expect(snap).toBeNull();
  });

  it("returns a snapshot even when the reset header is missing", () => {
    const snap = parseUnifiedRateLimitHeaders({ "anthropic-ratelimit-unified-7d-utilization": "0.5" }, OBS);
    expect(snap!.utilization).toBeCloseTo(0.5);
    expect(snap!.resetAt).toBeNull();
  });

  it("clamps out-of-range utilization to [0,1]", () => {
    const snap = parseUnifiedRateLimitHeaders({ "anthropic-ratelimit-unified-7d-utilization": "1.4" }, OBS);
    expect(snap!.utilization).toBe(1);
  });
});

describe("parseOAuthUsageJson", () => {
  it("reads seven_day utilization + resets_at", () => {
    const snap = parseOAuthUsageJson(
      { five_hour: { utilization: 0.1 }, seven_day: { utilization: 0.72, resets_at: "2026-07-16T18:00:00Z" } },
      OBS,
    );
    expect(snap!.utilization).toBeCloseTo(0.72);
    expect(snap!.resetAt?.toISOString()).toBe("2026-07-16T18:00:00.000Z");
    expect(snap!.source).toBe("anthropic-oauth-usage");
  });

  it("takes the most-restrictive of seven_day and seven_day_sonnet", () => {
    const snap = parseOAuthUsageJson(
      { seven_day: { utilization: 0.5, resets_at: 1784224800 }, seven_day_sonnet: { utilization: 0.9, resets_at: 1784228400 } },
      OBS,
    );
    expect(snap!.utilization).toBeCloseTo(0.9);
    expect(snap!.resetAt?.toISOString()).toBe("2026-07-16T19:00:00.000Z");
  });

  it("rescales a 0..100 used_percentage into 0..1", () => {
    const snap = parseOAuthUsageJson({ seven_day: { used_percentage: 63 } }, OBS);
    expect(snap!.utilization).toBeCloseTo(0.63);
  });

  it("returns null on an unrelated / empty body", () => {
    expect(parseOAuthUsageJson({ five_hour: { utilization: 0.2 } }, OBS)).toBeNull();
    expect(parseOAuthUsageJson(null, OBS)).toBeNull();
    expect(parseOAuthUsageJson("nope", OBS)).toBeNull();
  });
});

describe("parseCodexRateLimitsJson", () => {
  it("reads rateLimits.secondary usedPercent (0..100) + resetsAt", () => {
    const snap = parseCodexRateLimitsJson(
      { rateLimits: { primary: { usedPercent: 12 }, secondary: { usedPercent: 47, resetsAt: "2026-07-16T18:00:00Z" } } },
      OBS,
    );
    expect(snap!.utilization).toBeCloseTo(0.47);
    expect(snap!.resetAt?.toISOString()).toBe("2026-07-16T18:00:00.000Z");
    expect(snap!.source).toBe("codex-app-server");
  });

  it("accepts a full JSON-RPC envelope ({ result: { rateLimits } })", () => {
    const snap = parseCodexRateLimitsJson(
      { jsonrpc: "2.0", id: 1, result: { rateLimits: { secondary: { usedPercent: 30, resetsAt: 1784224800 } } } },
      OBS,
    );
    expect(snap!.utilization).toBeCloseTo(0.3);
    expect(snap!.resetAt?.toISOString()).toBe("2026-07-16T18:00:00.000Z");
  });

  it("returns null when secondary/weekly window is absent", () => {
    expect(parseCodexRateLimitsJson({ rateLimits: { primary: { usedPercent: 12 } } }, OBS)).toBeNull();
    expect(parseCodexRateLimitsJson({}, OBS)).toBeNull();
  });
});

describe("deriveRemainingRatio", () => {
  it("is 1 - utilization, clamped", () => {
    const snap: WeeklyQuotaSnapshot = { utilization: 0.63, resetAt: null, source: "anthropic-oauth-usage", observedAt: OBS };
    expect(deriveRemainingRatio(snap)).toBeCloseTo(0.37);
  });
});

describe("isWeeklyQuotaFresh", () => {
  const snap: WeeklyQuotaSnapshot = { utilization: 0.5, resetAt: null, source: "codex-app-server", observedAt: OBS };
  it("is fresh within the max age", () => {
    expect(isWeeklyQuotaFresh(snap, new Date("2026-07-16T12:20:00Z"))).toBe(true);
  });
  it("is stale past the max age", () => {
    expect(isWeeklyQuotaFresh(snap, new Date("2026-07-16T12:45:00Z"))).toBe(false);
  });
  it("treats a future-dated (clock-skew) observedAt as not fresh", () => {
    expect(isWeeklyQuotaFresh(snap, new Date("2026-07-16T11:00:00Z"))).toBe(false);
  });
});
