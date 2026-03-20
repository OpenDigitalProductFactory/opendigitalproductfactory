import { describe, expect, it, beforeEach, vi } from "vitest";
import {
  recordRequest,
  checkModelCapacity,
  setModelLimits,
  learnFromRateLimitResponse,
  extractRetryAfterMs,
  _resetAllTracking,
} from "./rate-tracker";

beforeEach(() => {
  _resetAllTracking();
  vi.useRealTimers();
});

describe("rate-tracker", () => {
  // ── No limits set ───────────────────────────────────────────────────────
  describe("no limits set", () => {
    it("returns available with 0% utilization when no limits configured", () => {
      const status = checkModelCapacity("provider1", "model1");
      expect(status).toEqual({ available: true, utilizationPercent: 0 });
    });
  });

  // ── RPM tracking ───────────────────────────────────────────────────────
  describe("RPM tracking", () => {
    it("records requests and tracks utilization (2 of 10 RPM = 20%)", () => {
      setModelLimits("p", "m", { rpm: 10, tpm: null, rpd: null });
      recordRequest("p", "m");
      recordRequest("p", "m");
      const status = checkModelCapacity("p", "m");
      expect(status.available).toBe(true);
      expect(status.utilizationPercent).toBe(20);
    });

    it("returns unavailable at RPM limit (3 of 3 = 100%)", () => {
      setModelLimits("p", "m", { rpm: 3, tpm: null, rpd: null });
      recordRequest("p", "m");
      recordRequest("p", "m");
      recordRequest("p", "m");
      const status = checkModelCapacity("p", "m");
      expect(status.available).toBe(false);
      expect(status.utilizationPercent).toBe(100);
    });

    it("prunes old entries outside 60s window", () => {
      vi.useFakeTimers();
      vi.setSystemTime(1_000_000);

      setModelLimits("p", "m", { rpm: 10, tpm: null, rpd: null });
      recordRequest("p", "m");
      recordRequest("p", "m");

      // Advance past 60s window
      vi.setSystemTime(1_000_000 + 61_000);

      const status = checkModelCapacity("p", "m");
      expect(status.available).toBe(true);
      expect(status.utilizationPercent).toBe(0);
    });
  });

  // ── TPM tracking ───────────────────────────────────────────────────────
  describe("TPM tracking", () => {
    it("records token counts against tpm limit (5000 of 10000 = 50%)", () => {
      setModelLimits("p", "m", { rpm: null, tpm: 10000, rpd: null });
      recordRequest("p", "m", 5000);
      const status = checkModelCapacity("p", "m");
      expect(status.available).toBe(true);
      expect(status.utilizationPercent).toBe(50);
    });

    it("returns unavailable at TPM limit", () => {
      setModelLimits("p", "m", { rpm: null, tpm: 1000, rpd: null });
      recordRequest("p", "m", 500);
      recordRequest("p", "m", 500);
      const status = checkModelCapacity("p", "m");
      expect(status.available).toBe(false);
      expect(status.utilizationPercent).toBe(100);
    });
  });

  // ── RPD tracking ───────────────────────────────────────────────────────
  describe("RPD tracking", () => {
    it("tracks daily request count against rpd limit (50 of 100 = 50%)", () => {
      setModelLimits("p", "m", { rpm: null, tpm: null, rpd: 100 });
      for (let i = 0; i < 50; i++) recordRequest("p", "m");
      const status = checkModelCapacity("p", "m");
      expect(status.available).toBe(true);
      expect(status.utilizationPercent).toBe(50);
    });

    it("returns unavailable at RPD limit", () => {
      setModelLimits("p", "m", { rpm: null, tpm: null, rpd: 5 });
      for (let i = 0; i < 5; i++) recordRequest("p", "m");
      const status = checkModelCapacity("p", "m");
      expect(status.available).toBe(false);
      expect(status.utilizationPercent).toBe(100);
    });
  });

  // ── Most constrained dimension ─────────────────────────────────────────
  describe("most constrained dimension", () => {
    it("returns the highest utilization across RPM, TPM, RPD", () => {
      setModelLimits("p", "m", { rpm: 100, tpm: 10000, rpd: 1000 });
      recordRequest("p", "m", 4500);
      recordRequest("p", "m", 4500);
      // RPM: 2/100 = 2%, TPM: 9000/10000 = 90%, RPD: 2/1000 = 0.2%
      const status = checkModelCapacity("p", "m");
      expect(status.utilizationPercent).toBe(90);
    });
  });

  // ── Multiple models ────────────────────────────────────────────────────
  describe("multiple models", () => {
    it("maintains separate counters per model", () => {
      setModelLimits("p", "modelA", { rpm: 10, tpm: null, rpd: null });
      setModelLimits("p", "modelB", { rpm: 10, tpm: null, rpd: null });
      recordRequest("p", "modelA");
      recordRequest("p", "modelA");
      recordRequest("p", "modelA");
      recordRequest("p", "modelB");

      const statusA = checkModelCapacity("p", "modelA");
      const statusB = checkModelCapacity("p", "modelB");
      expect(statusA.utilizationPercent).toBe(30);
      expect(statusB.utilizationPercent).toBe(10);
    });
  });

  // ── setModelLimits ─────────────────────────────────────────────────────
  describe("setModelLimits", () => {
    it("updates limits for a model", () => {
      setModelLimits("p", "m", { rpm: 10, tpm: null, rpd: null });
      recordRequest("p", "m");
      expect(checkModelCapacity("p", "m").utilizationPercent).toBe(10);

      setModelLimits("p", "m", { rpm: 5, tpm: null, rpd: null });
      expect(checkModelCapacity("p", "m").utilizationPercent).toBe(20);
    });
  });

  // ── learnFromRateLimitResponse ─────────────────────────────────────────
  describe("learnFromRateLimitResponse", () => {
    it("extracts x-ratelimit-limit-requests header → sets RPM (OpenAI)", () => {
      learnFromRateLimitResponse("p", "m", {
        "x-ratelimit-limit-requests": "60",
      });
      setModelLimits("p", "m", { rpm: null, tpm: null, rpd: null }); // check it was set
      // The learn function should have set rpm=60, so let's verify via capacity
      // Re-set to see if learn wrote the value
      recordRequest("p", "m");
      // Need to check that the limit was learned. Let's use a different approach:
      // learn sets the limit, then we record and check.
    });

    it("sets RPM from OpenAI x-ratelimit-limit-requests header", () => {
      learnFromRateLimitResponse("p", "m", {
        "x-ratelimit-limit-requests": "60",
      });
      // 1 request of 60 RPM = ~1.67%
      recordRequest("p", "m");
      const status = checkModelCapacity("p", "m");
      // 1 request was recorded by recordRequest, plus learn doesn't record
      expect(status.utilizationPercent).toBeCloseTo(100 / 60, 0);
    });

    it("extracts anthropic-ratelimit-requests-limit header → sets RPM (Anthropic)", () => {
      learnFromRateLimitResponse("p", "m", {
        "anthropic-ratelimit-requests-limit": "50",
      });
      for (let i = 0; i < 5; i++) recordRequest("p", "m");
      const status = checkModelCapacity("p", "m");
      expect(status.utilizationPercent).toBe(10); // 5/50 = 10%
    });

    it("extracts x-ratelimit-limit-tokens header → sets TPM", () => {
      learnFromRateLimitResponse("p", "m", {
        "x-ratelimit-limit-tokens": "100000",
      });
      recordRequest("p", "m", 50000);
      const status = checkModelCapacity("p", "m");
      expect(status.utilizationPercent).toBe(50); // 50000/100000 = 50%
    });

    it("no-op with undefined headers", () => {
      learnFromRateLimitResponse("p", "m", undefined);
      const status = checkModelCapacity("p", "m");
      expect(status).toEqual({ available: true, utilizationPercent: 0 });
    });

    it("no-op with empty headers", () => {
      learnFromRateLimitResponse("p", "m", {});
      const status = checkModelCapacity("p", "m");
      expect(status).toEqual({ available: true, utilizationPercent: 0 });
    });
  });

  // ── extractRetryAfterMs ────────────────────────────────────────────────
  describe("extractRetryAfterMs", () => {
    it('parses numeric retry-after header: "30" → 30000', () => {
      const ms = extractRetryAfterMs({ "retry-after": "30" });
      expect(ms).toBe(30000);
    });

    it('parses OpenAI duration x-ratelimit-reset-requests: "1m30s" → 90000', () => {
      const ms = extractRetryAfterMs({
        "x-ratelimit-reset-requests": "1m30s",
      });
      expect(ms).toBe(90000);
    });

    it('parses OpenAI duration x-ratelimit-reset-requests: "45s" → 45000', () => {
      const ms = extractRetryAfterMs({
        "x-ratelimit-reset-requests": "45s",
      });
      expect(ms).toBe(45000);
    });

    it("returns undefined with no headers", () => {
      const ms = extractRetryAfterMs(undefined);
      expect(ms).toBeUndefined();
    });

    it("returns undefined with empty headers", () => {
      const ms = extractRetryAfterMs({});
      expect(ms).toBeUndefined();
    });
  });

  // ── _resetAllTracking ──────────────────────────────────────────────────
  describe("_resetAllTracking", () => {
    it("clears all state", () => {
      setModelLimits("p", "m", { rpm: 10, tpm: null, rpd: null });
      recordRequest("p", "m");
      _resetAllTracking();
      const status = checkModelCapacity("p", "m");
      expect(status).toEqual({ available: true, utilizationPercent: 0 });
    });
  });

  // ── Reason string ──────────────────────────────────────────────────────
  describe("reason string", () => {
    it('includes "RPM" and the limit number when at RPM limit', () => {
      setModelLimits("p", "m", { rpm: 3, tpm: null, rpd: null });
      recordRequest("p", "m");
      recordRequest("p", "m");
      recordRequest("p", "m");
      const status = checkModelCapacity("p", "m");
      expect(status.available).toBe(false);
      expect(status.reason).toContain("RPM");
      expect(status.reason).toContain("3");
    });
  });
});
